import "server-only";
import { getAddress, parseAbiItem, type Address, type PublicClient } from "viem";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { ponsFactoryAbi } from "@/lib/contracts/pons-abi";
import { PONS_FACTORY, PONS_FACTORY_START_BLOCK } from "@/lib/contracts/constants";
import { features } from "@/lib/config/server";
import { query } from "@/lib/database/pool";
import { NATIVE_QUOTE, type QuoteAsset } from "@/lib/market/onchain";

// Pair assets a Pons launch can be priced in besides native ETH: Robinhood stock tokens
// ("<Company> • Robinhood Token"), USDG, … The set is DISCOVERED from the factory's own
// PairTokenApprovalUpdated history — the protocol owner approves and revokes assets whenever it
// likes, so a checked-in list would go stale. Only the newest event per token counts, every
// candidate is re-checked live with approvedPairTokens(), and symbol / name / decimals are read
// from the token (USDG is 6 decimals, everything else 18).
//
// The scan is incremental: approvals and a block watermark are stored in Postgres (pair_tokens +
// indexer_state 'pairs') when a database is configured, otherwise kept in memory per instance.

const PAIR_APPROVAL = parseAbiItem("event PairTokenApprovalUpdated(address indexed pairToken, bool approved)");
const SCAN_CHUNK = 1_000_000n; // a 2M-block window answers in ~0.5 s on the public RPC
const REFRESH_MS = 10 * 60_000;
const WATERMARK = "pairs";

interface ApprovalRow {
  address: string;
  approved: boolean;
  block: bigint;
  logIndex: number;
}

const mem: { rows: Map<string, ApprovalRow>; scannedTo: bigint; assets: QuoteAsset[] | null; at: number } = {
  rows: new Map(),
  scannedTo: PONS_FACTORY_START_BLOCK - 1n,
  assets: null,
  at: 0,
};

const newer = (a: ApprovalRow, b: ApprovalRow | undefined) => !b || a.block > b.block || (a.block === b.block && a.logIndex > b.logIndex);

async function loadState(useDb: boolean): Promise<{ rows: Map<string, ApprovalRow>; scannedTo: bigint }> {
  if (!useDb) return { rows: new Map(mem.rows), scannedTo: mem.scannedTo };
  const [wm] = await query<{ last_block: string }>(`SELECT last_block::text FROM indexer_state WHERE name = $1`, [WATERMARK]);
  const rows = await query<{ address: string; approved: boolean; event_block: string; event_log_index: number }>(
    `SELECT address, approved, event_block::text, event_log_index FROM pair_tokens`,
  );
  return {
    rows: new Map(rows.map((r) => [r.address, { address: r.address, approved: r.approved, block: BigInt(r.event_block), logIndex: r.event_log_index }])),
    scannedTo: wm ? BigInt(wm.last_block) : PONS_FACTORY_START_BLOCK - 1n,
  };
}

/** Scan new PairTokenApprovalUpdated events since the watermark. */
async function scanApprovals(client: PublicClient, useDb: boolean): Promise<Map<string, ApprovalRow>> {
  const state = await loadState(useDb);
  const head = await client.getBlockNumber();
  let from = state.scannedTo + 1n;
  const changed = new Map<string, ApprovalRow>();
  while (from <= head) {
    const to = from + SCAN_CHUNK - 1n < head ? from + SCAN_CHUNK - 1n : head;
    const logs = await client.getLogs({ address: PONS_FACTORY, event: PAIR_APPROVAL, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const row: ApprovalRow = { address: l.args.pairToken!.toLowerCase(), approved: l.args.approved!, block: l.blockNumber!, logIndex: l.logIndex! };
      if (newer(row, state.rows.get(row.address))) {
        state.rows.set(row.address, row);
        changed.set(row.address, row);
      }
    }
    from = to + 1n;
  }
  if (useDb) {
    for (const r of changed.values()) {
      await query(
        `INSERT INTO pair_tokens (address, approved, event_block, event_log_index) VALUES ($1,$2,$3,$4)
         ON CONFLICT (address) DO UPDATE SET approved = EXCLUDED.approved, event_block = EXCLUDED.event_block,
           event_log_index = EXCLUDED.event_log_index, updated_at = now()`,
        [r.address, r.approved, r.block.toString(), r.logIndex],
      );
    }
    await query(
      `INSERT INTO indexer_state (name, first_block, last_block) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET last_block = EXCLUDED.last_block, updated_at = now()`,
      [WATERMARK, PONS_FACTORY_START_BLOCK.toString(), head.toString()],
    );
  } else {
    mem.rows = state.rows;
    mem.scannedTo = head;
  }
  return state.rows;
}

async function describe(client: PublicClient, address: Address): Promise<QuoteAsset | null> {
  // Confirmed against current state, not just the log: a revocation we failed to read would
  // otherwise offer an asset every launch reverts on.
  const approved = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "approvedPairTokens", args: [address] });
  if (!approved) return null;
  try {
    const [symbol, name, tokenDecimals, econ] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "pairTokenEconomics", args: [address] }),
    ]);
    const [phantomQuote, graduationThreshold, econDecimals] = econ;
    // The factory prices with the economics record's decimals; they must agree with the token.
    if (Number(econDecimals) !== Number(tokenDecimals) || graduationThreshold === 0n) return null;
    return {
      address: getAddress(address),
      symbol,
      name: name.split("•")[0]!.trim() || symbol,
      decimals: Number(tokenDecimals),
      isNative: false,
      graduationThreshold: graduationThreshold.toString(),
      phantomQuote: phantomQuote.toString(),
    };
  } catch {
    return null; // an asset whose metadata cannot be read is never offered by a guessed name
  }
}

/**
 * Pair assets accepted by the Pons factory right now: native ETH first, then every approved ERC-20
 * (sorted by symbol). Cached for REFRESH_MS per instance.
 */
export async function listPairAssets(client: PublicClient, opts: { force?: boolean } = {}): Promise<QuoteAsset[]> {
  if (!opts.force && mem.assets && Date.now() - mem.at < REFRESH_MS) return mem.assets;
  const useDb = features().database;
  const rows = await scanApprovals(client, useDb);
  const candidates = [...rows.values()].filter((r) => r.approved).map((r) => getAddress(r.address));
  const described = await Promise.all(candidates.map((a) => describe(client, a).catch(() => null)));
  const erc20 = described.filter((a): a is QuoteAsset => a !== null).sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (useDb) {
    for (const a of erc20) {
      await query(
        `UPDATE pair_tokens SET symbol = $2, name = $3, decimals = $4, phantom_quote = $5, graduation_threshold = $6, updated_at = now() WHERE address = $1`,
        [a.address.toLowerCase(), a.symbol, a.name ?? null, a.decimals, a.phantomQuote ?? null, a.graduationThreshold ?? null],
      );
    }
  }
  mem.assets = [NATIVE_QUOTE, ...erc20];
  mem.at = Date.now();
  return mem.assets;
}

/** Is `address` a pair asset a launch can use right now? (ETH always; ERC-20s checked live.) */
export async function isAcceptedPair(client: PublicClient, address: string): Promise<boolean> {
  if (address.toLowerCase() === NATIVE_QUOTE.address) return true;
  return client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "approvedPairTokens", args: [getAddress(address)] });
}
