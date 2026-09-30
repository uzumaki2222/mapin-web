import "server-only";
import { decodeEventLog, getAddress, parseAbiItem, type Address, type Log, type PublicClient } from "viem";
import { db, query } from "@/lib/database/pool";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { pancakeV2PairAbi } from "@/lib/contracts/pancake-abi";
import { PORTAL_ADDRESS, ZERO_ADDRESS } from "@/lib/contracts/constants";
import { readLensState, verifyDexPool } from "@/lib/market/onchain";
import { phaseFromStatus } from "@/lib/market/state";
import { fetchTokenMetadata } from "@/lib/metadata/upload";
import { finalizeLaunch } from "@/lib/market/finalize";
import type { LaunchIntentRow } from "@/lib/database/queries";
import { serverEnv } from "@/lib/config/server";

// Restart-safe, idempotent indexer.
//  * cursor + block hash in indexer_state; recent hashes in indexer_blocks for reorg rewind
//  * processes only blocks CONFIRMATIONS behind head; every insert is ON CONFLICT DO NOTHING
//  * a Postgres advisory lock guarantees a single writer across processes / cron invocations

const STATE = "main";
const CONFIRMATIONS = 5n;
const CHUNK = 1_000n; // eth_getLogs block span per request
const KEEP_BLOCK_HASHES = 256n;
const LOCK_KEY = 0x0c0dedn; // arbitrary constant

const TOKEN_BOUGHT = parseAbiItem("event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)");
const TOKEN_SOLD = parseAbiItem("event TokenSold(uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)");
const LAUNCHED_TO_DEX = parseAbiItem("event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)");
const TOKEN_CREATED = parseAbiItem("event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SWAP = parseAbiItem("event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)");

interface MarketRef {
  id: string;
  token: string;
  pool: string | null;
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
  const from = last + 1n;
  const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;

  const markets = await loadMarkets();
  const byToken = new Map(markets.map((m) => [m.token, m]));
  const byPool = new Map(markets.filter((m) => m.pool).map((m) => [m.pool!, m]));
  const intents = await query<LaunchIntentRow>(
    `SELECT * FROM launch_intents WHERE consumed_at IS NULL AND created_at > now() - interval '2 days'`,
  );
  const intentByToken = new Map(intents.filter((i) => i.predicted_token).map((i) => [lc(i.predicted_token!), i]));

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

  // ---- Portal events: curve trades, graduation, creations (for intent recovery)
  // The Portal serves every token on the chain and its event args are not indexed, so logs are
  // filtered client-side. Skip the (large) request entirely when there is nothing to watch.
  const watchedEvents = [
    ...(markets.length ? [TOKEN_BOUGHT, TOKEN_SOLD, LAUNCHED_TO_DEX] : []),
    ...(intents.length ? [TOKEN_CREATED] : []),
  ];
  const portalLogs = watchedEvents.length
    ? await client.getLogs({ address: PORTAL_ADDRESS, events: watchedEvents, fromBlock: from, toBlock: to })
    : [];
  for (const log of portalLogs) {
    const ev = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics });
    if (ev.eventName === "TokenCreated") {
      const intent = intentByToken.get(lc(ev.args.token));
      if (intent && log.transactionHash) {
        try {
          const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
          const done = await finalizeLaunch(client, intent, receipt);
          if (!done.alreadyRecorded) {
            inserted++;
            console.info(`[indexer] recovered market ${done.slug} → ${done.tokenAddress}`);
          }
        } catch (err) {
          console.error(`[indexer] could not finalize intent ${intent.id}`, err);
        }
      }
      continue;
    }
    const tokenAddr = "token" in ev.args ? lc(ev.args.token as string) : "";
    const m = byToken.get(tokenAddr);
    if (!m) continue;
    const blk = await blockInfo(log.blockNumber!);
    if (ev.eventName === "TokenBought" || ev.eventName === "TokenSold") {
      const buy = ev.eventName === "TokenBought";
      const a = ev.args as { ts: bigint; amount: bigint; eth: bigint; fee: bigint; postPrice: bigint; buyer?: string; seller?: string };
      inserted += await insertActivity({
        marketId: m.id, type: buy ? "buy" : "sell", venue: "curve", wallet: lc((buy ? a.buyer : a.seller)!), log, blockHash: blk.hash,
        amountIn: buy ? a.eth : a.amount, amountOut: buy ? a.amount : a.eth, quoteVolume: a.eth, fee: a.fee, postPrice: a.postPrice,
        ts: new Date(Number(a.ts) * 1000),
      });
    } else if (ev.eventName === "LaunchedToDEX") {
      const a = ev.args as { pool: string };
      inserted += await insertActivity({ marketId: m.id, type: "graduate", venue: "dex", wallet: null, log, blockHash: blk.hash, ts: blk.ts });
      await query(
        `UPDATE markets SET status = 'graduated', pool_address = $2, graduated_at = COALESCE(graduated_at, $3) WHERE id = $1`,
        [m.id, lc(a.pool), blk.ts],
      );
      m.pool = lc(a.pool);
      byPool.set(m.pool, m);
    }
  }

  // ---- PancakeSwap v2 swaps for graduated markets
  if (byPool.size) {
    const pools = [...byPool.keys()] as Address[];
    for (let i = 0; i < pools.length; i += 50) {
      const logs = await client.getLogs({ address: pools.slice(i, i + 50), event: SWAP, fromBlock: from, toBlock: to });
      for (const log of logs) {
        const m = byPool.get(lc(log.address))!;
        const token0 = await pairToken0(client, log.address);
        const tokenIs0 = token0 === m.token;
        const { amount0In, amount1In, amount0Out, amount1Out } = log.args as { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint };
        const tokenOut = tokenIs0 ? amount0Out : amount1Out;
        const tokenIn = tokenIs0 ? amount0In : amount1In;
        const quoteIn = tokenIs0 ? amount1In : amount0In;
        const quoteOut = tokenIs0 ? amount1Out : amount0Out;
        const isBuy = tokenOut > 0n && quoteIn > 0n;
        const isSell = tokenIn > 0n && quoteOut > 0n;
        if (!isBuy && !isSell) continue;
        const blk = await blockInfo(log.blockNumber!);
        const tx = await client.getTransaction({ hash: log.transactionHash! });
        inserted += await insertActivity({
          marketId: m.id, type: isBuy ? "buy" : "sell", venue: "dex", wallet: lc(tx.from), log, blockHash: blk.hash,
          amountIn: isBuy ? quoteIn : tokenIn, amountOut: isBuy ? tokenOut : quoteOut, quoteVolume: isBuy ? quoteIn : quoteOut, ts: blk.ts,
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
  await query(`DELETE FROM indexer_blocks WHERE block_number < $1`, [(to - KEEP_BLOCK_HASHES * CHUNK).toString()]);
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
  return fromBlock - 2n * CHUNK;
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
  const rows = await query<{ id: string; token_address: string; pool_address: string | null; launch_block: string }>(
    `SELECT id, token_address, pool_address, launch_block::text FROM markets`,
  );
  return rows.map((r) => ({ id: r.id, token: r.token_address, pool: r.pool_address, launchBlock: BigInt(r.launch_block) }));
}

const token0Cache = new Map<string, string>();
export async function pairToken0(client: PublicClient, pair: Address): Promise<string> {
  const key = lc(pair);
  let t = token0Cache.get(key);
  if (!t) {
    t = lc(await client.readContract({ address: pair, abi: pancakeV2PairAbi, functionName: "token0" }));
    token0Cache.set(key, t);
  }
  return t;
}

export async function insertActivity(a: {
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
  const rows = await query<{ id: string; token_address: string; launch_block: string; image_cid: string | null; meta_cid: string }>(
    `SELECT id, token_address, launch_block::text, image_cid, meta_cid FROM markets ORDER BY stats_updated_at NULLS FIRST LIMIT $1`,
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
        const v = await verifyDexPool(client, token, lens);
        pool = lc(lens.pool);
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
             ) t WHERE addr <> $2 GROUP BY addr HAVING SUM(delta) > 0) x`,
          [r.id, ZERO_ADDRESS],
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
