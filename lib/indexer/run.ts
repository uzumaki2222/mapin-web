import "server-only";
import { getAddress, parseAbiItem, type Address, type Hex, type Log, type PublicClient } from "viem";
import { db, query } from "@/lib/database/pool";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { PONS_FACTORY, V4_POOL_MANAGER, ZERO_ADDRESS } from "@/lib/contracts/constants";
import { readLensState, verifyDexPool } from "@/lib/market/onchain";
import { phaseFromStatus } from "@/lib/market/state";
import { fetchTokenMetadata } from "@/lib/metadata/upload";
import { finalizeLaunch } from "@/lib/market/finalize";
import { decodeCurveTrade } from "@/lib/launch/receipt";
import type { LaunchIntentRow } from "@/lib/database/queries";
import { serverEnv } from "@/lib/config/server";

// Restart-safe, idempotent indexer.
//  * cursor + block hash in indexer_state; recent hashes in indexer_blocks for reorg rewind
//  * processes only blocks CONFIRMATIONS behind head; every insert is ON CONFLICT DO NOTHING
//  * a Postgres advisory lock guarantees a single writer across processes / cron invocations
//
// Robinhood Chain produces ~10 blocks per second, so spans are large (INDEXER_CHUNK, default 20k).

const STATE = "main";
const CONFIRMATIONS = 20n; // ~2 s on Robinhood Chain
const KEEP_BLOCK_HASHES = 256n;
const LOCK_KEY = 0x0c0dedn; // arbitrary constant

const TOKEN_LAUNCHED = parseAbiItem("event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)");
const POOL_GRADUATED = parseAbiItem("event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)");
const CURVE_BUY = parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)");
const CURVE_SELL = parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const V4_SWAP = parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)");

interface MarketRef {
  id: string;
  token: string;
  curve: string | null;
  /** Uniswap v4 pool id after graduation */
  pool: string | null;
  /** pair asset (zero address = ETH) */
  quote: string;
  launchBlock: bigint;
}

export interface IndexerPassResult {
  from: bigint | null;
  to: bigint | null;
  head: bigint;
  caughtUp: boolean;
  inserted: number;
  reorgRewoundTo?: bigint;
  skipped?: string;
}

const lc = (a: string) => a.toLowerCase();

export async function runIndexerPass(client: PublicClient): Promise<IndexerPassResult> {
  const lockClient = await db().connect();
  try {
    const got = await lockClient.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY.toString()]);
    if (!got.rows[0]?.ok) return { from: null, to: null, head: 0n, caughtUp: false, inserted: 0, skipped: "another indexer holds the lock" };
    try {
      return await pass(client);
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY.toString()]);
    }
  } finally {
    lockClient.release();
  }
}

async function pass(client: PublicClient): Promise<IndexerPassResult> {
  const latest = await client.getBlockNumber();
  const head = latest - CONFIRMATIONS;

  let state = (await query<{ last_block: string; last_block_hash: string | null }>(`SELECT last_block, last_block_hash FROM indexer_state WHERE name = $1`, [STATE]))[0];
  if (!state) {
    const start = serverEnv().INDEXER_START_BLOCK;
    const initial = start !== undefined ? BigInt(start) - 1n : head;
    await query(
      `INSERT INTO indexer_state (name, first_block, last_block) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
      [STATE, (initial + 1n).toString(), initial.toString()],
    );
    state = { last_block: initial.toString(), last_block_hash: null };
  }
  let last = BigInt(state.last_block);

  // ---- reorg detection: our last processed block must still be canonical
  let reorgRewoundTo: bigint | undefined;
  if (state.last_block_hash) {
    const block = await client.getBlock({ blockNumber: last });
    if (lc(block.hash!) !== state.last_block_hash) {
      const ancestor = await findCommonAncestor(client, last);
      await rewindTo(ancestor);
      last = ancestor;
      reorgRewoundTo = ancestor;
    }
  }

  if (last >= head) return { from: null, to: null, head, caughtUp: true, inserted: 0, reorgRewoundTo };
  const chunk = BigInt(serverEnv().INDEXER_CHUNK);
  const from = last + 1n;
  const to = from + chunk - 1n < head ? from + chunk - 1n : head;

  const markets = await loadMarkets();
  const byToken = new Map(markets.map((m) => [m.token, m]));
  const byCurve = new Map(markets.filter((m) => m.curve).map((m) => [m.curve!, m]));
  const byPool = new Map(markets.filter((m) => m.pool).map((m) => [m.pool!, m]));
  const intents = await query<LaunchIntentRow>(
    `SELECT * FROM launch_intents WHERE consumed_at IS NULL AND created_at > now() - interval '2 days'`,
  );
  const intentsByCreator = new Map<string, LaunchIntentRow[]>();
  for (const i of intents) intentsByCreator.set(lc(i.creator_wallet), [...(intentsByCreator.get(lc(i.creator_wallet)) ?? []), i]);

  let inserted = 0;
  const blockCache = new Map<bigint, { hash: string; ts: Date }>();
  const blockInfo = async (n: bigint) => {
    let b = blockCache.get(n);
    if (!b) {
      const blk = await client.getBlock({ blockNumber: n });
      b = { hash: lc(blk.hash!), ts: new Date(Number(blk.timestamp) * 1000) };
      blockCache.set(n, b);
    }
    return b;
  };

  // ---- factory: launches (intent recovery when the browser closed) and graduations.
  // TokenLaunched.deployer is indexed, so only launches by wallets with an open intent are fetched.
  if (intentsByCreator.size) {
    const creators = [...intentsByCreator.keys()] as Address[];
    for (let i = 0; i < creators.length; i += 50) {
      const logs = await client.getLogs({ address: PONS_FACTORY, event: TOKEN_LAUNCHED, args: { deployer: creators.slice(i, i + 50) }, fromBlock: from, toBlock: to });
      for (const log of logs) {
        if (byToken.has(lc(log.args.token!)) || !log.transactionHash) continue;
        const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
        for (const intent of intentsByCreator.get(lc(log.args.deployer!)) ?? []) {
          try {
            const done = await finalizeLaunch(client, intent, receipt);
            if (!done.alreadyRecorded) {
              inserted++;
              console.info(`[indexer] recovered market ${done.slug} → ${done.tokenAddress}`);
            }
            break;
          } catch {
            /* not this intent's launch (different token metadata) — try the next intent */
          }
        }
      }
    }
  }
  if (markets.length) {
    const tokens = [...byToken.keys()] as Address[];
    for (let i = 0; i < tokens.length; i += 50) {
      const logs = await client.getLogs({ address: PONS_FACTORY, event: POOL_GRADUATED, args: { token: tokens.slice(i, i + 50) }, fromBlock: from, toBlock: to });
      for (const log of logs) {
        const m = byToken.get(lc(log.args.token!));
        if (!m) continue;
        const blk = await blockInfo(log.blockNumber!);
        inserted += await insertActivity({ marketId: m.id, type: "graduate", venue: "dex", wallet: null, log, blockHash: blk.hash, ts: blk.ts });
        const verified = await verifyDexPool(client, getAddress(m.token)).catch(() => null);
        await query(
          `UPDATE markets SET status = 'graduated', pool_address = COALESCE($2, pool_address), graduated_at = COALESCE(graduated_at, $3),
                  pool_verified_at = CASE WHEN $2 IS NOT NULL THEN now() ELSE pool_verified_at END WHERE id = $1`,
          [m.id, verified ? lc(verified.poolId) : null, blk.ts],
        );
        if (verified) {
          m.pool = lc(verified.poolId);
          byPool.set(m.pool, m);
        }
      }
    }
  }

  // ---- bonding-curve trades (each market has its own curve contract)
  if (byCurve.size) {
    const curves = [...byCurve.keys()] as Address[];
    for (let i = 0; i < curves.length; i += 50) {
      const logs = await client.getLogs({ address: curves.slice(i, i + 50), events: [CURVE_BUY, CURVE_SELL], fromBlock: from, toBlock: to });
      for (const log of logs) {
        const m = byCurve.get(lc(log.address));
        if (!m) continue;
        const t = decodeCurveTrade(log as Log, log.address);
        if (!t) continue;
        const blk = await blockInfo(log.blockNumber!);
        inserted += await insertActivity({
          marketId: m.id, type: t.side, venue: "curve", wallet: lc(t.wallet), log: log as Log, blockHash: blk.hash,
          amountIn: t.amountIn, amountOut: t.amountOut, quoteVolume: t.quoteVolume, fee: t.fee, ts: blk.ts,
        });
      }
    }
  }

  // ---- Uniswap v4 swaps for graduated markets (PoolManager Swap, filtered by pool id).
  // Deltas are from the swapper's side: negative = paid into the pool, positive = received.
  if (byPool.size) {
    const pools = [...byPool.keys()] as Hex[];
    for (let i = 0; i < pools.length; i += 50) {
      const logs = await client.getLogs({ address: V4_POOL_MANAGER, event: V4_SWAP, args: { id: pools.slice(i, i + 50) }, fromBlock: from, toBlock: to });
      for (const log of logs) {
        const m = byPool.get(lc(log.args.id!));
        if (!m) continue;
        // v4 sorts the pool currencies by address (native ETH, address 0, is always currency0).
        const tokenIs0 = lc(m.token) < lc(m.quote);
        const a0 = log.args.amount0!;
        const a1 = log.args.amount1!;
        const tokenDelta = tokenIs0 ? a0 : a1;
        const quoteDelta = tokenIs0 ? a1 : a0;
        const isBuy = tokenDelta > 0n && quoteDelta < 0n;
        const isSell = tokenDelta < 0n && quoteDelta > 0n;
        if (!isBuy && !isSell) continue;
        const blk = await blockInfo(log.blockNumber!);
        const tx = await client.getTransaction({ hash: log.transactionHash! });
        const abs = (v: bigint) => (v < 0n ? -v : v);
        inserted += await insertActivity({
          marketId: m.id, type: isBuy ? "buy" : "sell", venue: "dex", wallet: lc(tx.from), log: log as Log, blockHash: blk.hash,
          amountIn: isBuy ? abs(quoteDelta) : abs(tokenDelta), amountOut: isBuy ? tokenDelta : quoteDelta,
          quoteVolume: abs(quoteDelta), ts: blk.ts,
        });
      }
    }
  }

  // ---- token transfers (holder counts)
  const tokens = [...byToken.keys()] as Address[];
  for (let i = 0; i < tokens.length; i += 50) {
    const logs = await client.getLogs({ address: tokens.slice(i, i + 50), event: TRANSFER, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const m = byToken.get(lc(log.address));
      if (!m) continue;
      const { from: f, to: t, value } = log.args as { from: string; to: string; value: bigint };
      const res = await query(
        `INSERT INTO token_transfers (market_id, from_address, to_address, value, tx_hash, log_index, block_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id`,
        [m.id, lc(f), lc(t), value.toString(), lc(log.transactionHash!), log.logIndex, log.blockNumber!.toString()],
      );
      inserted += res.length;
    }
  }

  // ---- advance cursor (store hash for reorg detection)
  const toBlk = await blockInfo(to);
  await query(`INSERT INTO indexer_blocks (block_number, block_hash) VALUES ($1,$2) ON CONFLICT (block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash`, [to.toString(), toBlk.hash]);
  await query(`DELETE FROM indexer_blocks WHERE block_number < $1`, [(to - KEEP_BLOCK_HASHES * chunk).toString()]);
  await query(`UPDATE indexer_state SET last_block = $2, last_block_hash = $3, updated_at = now() WHERE name = $1`, [STATE, to.toString(), toBlk.hash]);

  return { from, to, head, caughtUp: to >= head, inserted, reorgRewoundTo };
}

async function findCommonAncestor(client: PublicClient, fromBlock: bigint): Promise<bigint> {
  const rows = await query<{ block_number: string; block_hash: string }>(
    `SELECT block_number::text, block_hash FROM indexer_blocks WHERE block_number < $1 ORDER BY block_number DESC LIMIT 64`,
    [fromBlock.toString()],
  );
  for (const r of rows) {
    const n = BigInt(r.block_number);
    const blk = await client.getBlock({ blockNumber: n });
    if (lc(blk.hash!) === r.block_hash) return n;
  }
  // Nothing matched in the stored window: rewind a safe fixed distance.
  return fromBlock - 2n * BigInt(serverEnv().INDEXER_CHUNK);
}

async function rewindTo(ancestor: bigint): Promise<void> {
  console.warn(`[indexer] reorg detected — rewinding to block ${ancestor}`);
  const n = ancestor.toString();
  await query(`DELETE FROM activity WHERE block_number > $1 AND type <> 'launch'`, [n]);
  await query(`DELETE FROM token_transfers WHERE block_number > $1`, [n]);
  await query(`DELETE FROM indexer_blocks WHERE block_number > $1`, [n]);
  await query(`UPDATE indexer_state SET last_block = $2, last_block_hash = NULL, updated_at = now() WHERE name = $1`, [STATE, n]);
}

async function loadMarkets(): Promise<MarketRef[]> {
  const rows = await query<{ id: string; token_address: string; curve_address: string | null; pool_address: string | null; quote_token: string; launch_block: string }>(
    `SELECT id, token_address, curve_address, pool_address, quote_token, launch_block::text FROM markets`,
  );
  return rows.map((r) => ({ id: r.id, token: r.token_address, curve: r.curve_address, pool: r.pool_address, quote: r.quote_token, launchBlock: BigInt(r.launch_block) }));
}

async function insertActivity(a: {
  marketId: string;
  type: "buy" | "sell" | "graduate";
  venue: "curve" | "dex";
  wallet: string | null;
  log: Log;
  blockHash: string;
  amountIn?: bigint;
  amountOut?: bigint;
  quoteVolume?: bigint;
  fee?: bigint;
  postPrice?: bigint;
  ts: Date;
}): Promise<number> {
  const s = (v?: bigint) => (v === undefined ? null : v.toString());
  const rows = await query(
    `INSERT INTO activity (market_id, type, venue, wallet, tx_hash, log_index, block_number, block_hash, amount_in, amount_out,
                           quote_volume, fee, post_price, "timestamp")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id`,
    [a.marketId, a.type, a.venue, a.wallet, lc(a.log.transactionHash!), a.log.logIndex, a.log.blockNumber!.toString(), a.blockHash,
      s(a.amountIn), s(a.amountOut), s(a.quoteVolume), s(a.fee), s(a.postPrice), a.ts],
  );
  return rows.length;
}

/**
 * Refresh live statistics from the chain (price, reserve, progress, status, verified pool,
 * total supply) plus holder counts from indexed transfers. Rotates through markets.
 */
export async function refreshMarketStats(client: PublicClient, limit = 25): Promise<number> {
  const idx = await query<{ first_block: string }>(`SELECT first_block::text FROM indexer_state WHERE name = $1`, [STATE]);
  const firstIndexed = idx[0] ? BigInt(idx[0].first_block) : null;
  const rows = await query<{ id: string; token_address: string; curve_address: string | null; launch_block: string; image_cid: string | null; meta_cid: string }>(
    `SELECT id, token_address, curve_address, launch_block::text, image_cid, meta_cid FROM markets ORDER BY stats_updated_at NULLS FIRST LIMIT $1`,
    [limit],
  );
  let n = 0;
  for (const r of rows) {
    try {
      const token = getAddress(r.token_address);
      const lens = await readLensState(client, token);
      const phase = phaseFromStatus(lens.status);
      const totalSupply = await client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" });
      let pool: string | null = null;
      let poolVerified = false;
      if (phase === "graduated") {
        const v = await verifyDexPool(client, token);
        pool = v ? lc(v.poolId) : lens.pool ? lc(lens.pool) : null;
        poolVerified = Boolean(v);
      }
      // Holder counts are complete only if transfers were indexed since launch.
      const fullHistory = firstIndexed !== null && firstIndexed <= BigInt(r.launch_block);
      let holders: number | null = null;
      if (fullHistory) {
        const h = await query<{ holders: string }>(
          `SELECT COUNT(*)::text AS holders FROM (
             SELECT addr FROM (
               SELECT to_address AS addr, value AS delta FROM token_transfers WHERE market_id = $1
               UNION ALL SELECT from_address, -value FROM token_transfers WHERE market_id = $1
             ) t WHERE addr <> ALL($2::text[]) GROUP BY addr HAVING SUM(delta) > 0) x`,
          // protocol-held balances (bonding curve, v4 pool manager) are not holders
          [r.id, [ZERO_ADDRESS, r.curve_address ?? ZERO_ADDRESS, lc(V4_POOL_MANAGER)]],
        );
        holders = Number(h[0]?.holders ?? 0);
      }
      let imageCid = r.image_cid;
      if (!imageCid) imageCid = (await fetchTokenMetadata(r.meta_cid))?.image ?? null;
      await query(
        `UPDATE markets SET price_raw = $2, reserve_raw = $3, circulating_raw = $4, total_supply_raw = $5, progress_wad = $6,
                status = CASE WHEN $7 THEN 'graduated' ELSE status END,
                graduated_at = CASE WHEN $7 AND graduated_at IS NULL THEN now() ELSE graduated_at END,
                pool_address = COALESCE($8, pool_address),
                pool_verified_at = CASE WHEN $9 THEN now() ELSE pool_verified_at END,
                holders = COALESCE($10, holders), image_cid = COALESCE($11, image_cid), stats_updated_at = now()
         WHERE id = $1`,
        [r.id, lens.price.toString(), lens.reserve.toString(), lens.circulatingSupply.toString(), totalSupply.toString(),
          lens.progress.toString(), phase === "graduated", pool, poolVerified, holders, imageCid],
      );
      n++;
    } catch (err) {
      console.error(`[indexer] stats refresh failed for ${r.token_address}`, err);
      await query(`UPDATE markets SET stats_updated_at = now() WHERE id = $1`, [r.id]);
    }
  }
  return n;
}
