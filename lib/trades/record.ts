import "server-only";
import { decodeEventLog, parseAbiItem, type Address, type PublicClient, type TransactionReceipt } from "viem";
import { query } from "@/lib/database/pool";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { PORTAL_ADDRESS } from "@/lib/contracts/constants";
import { insertActivity, pairToken0 } from "@/lib/indexer/run";

const SWAP = parseAbiItem("event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)");
const lc = (a: string) => a.toLowerCase();

/**
 * Records the mapin-token trades contained in one mined transaction (bonding-curve buys/sells on the
 * Portal and PancakeSwap v2 swaps of graduated tokens). Everything comes from the on-chain receipt,
 * inserts are idempotent (tx_hash, log_index), so the indexer and this path never double count.
 */
export async function recordTradesFromReceipt(client: PublicClient, receipt: TransactionReceipt): Promise<number> {
  if (receipt.status !== "success") return 0;
  const portalLc = lc(PORTAL_ADDRESS);
  const candidates = [...new Set([...receipt.logs.map((l) => lc(l.address)), ...tokensInPortalLogs(receipt)])];
  const markets = await query<{ id: string; token_address: string; pool_address: string | null }>(
    `SELECT id, token_address, pool_address FROM markets
     WHERE token_address::text = ANY($1::text[]) OR pool_address::text = ANY($1::text[])`,
    [candidates],
  );
  if (!markets.length) return 0;
  const byToken = new Map(markets.map((m) => [m.token_address, m]));
  const byPool = new Map(markets.filter((m) => m.pool_address).map((m) => [m.pool_address!, m]));
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const blockHash = lc(receipt.blockHash);
  const blockTs = new Date(Number(block.timestamp) * 1000);
  let inserted = 0;

  for (const log of receipt.logs) {
    const addr = lc(log.address);
    if (addr === portalLc) {
      let ev: { eventName: string; args: unknown };
      try {
        ev = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics }) as { eventName: string; args: unknown };
      } catch {
        continue;
      }
      if (ev.eventName !== "TokenBought" && ev.eventName !== "TokenSold") continue;
      const a = ev.args as { token: string; ts: bigint; amount: bigint; eth: bigint; fee: bigint; postPrice: bigint; buyer?: string; seller?: string };
      const m = byToken.get(lc(a.token));
      if (!m) continue;
      const buy = ev.eventName === "TokenBought";
      inserted += await insertActivity({
        marketId: m.id, type: buy ? "buy" : "sell", venue: "curve", wallet: lc((buy ? a.buyer : a.seller) ?? receipt.from), log, blockHash,
        amountIn: buy ? a.eth : a.amount, amountOut: buy ? a.amount : a.eth, quoteVolume: a.eth, fee: a.fee, postPrice: a.postPrice,
        ts: new Date(Number(a.ts) * 1000),
      });
    } else if (byPool.has(addr)) {
      let args: { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint };
      try {
        args = decodeEventLog({ abi: [SWAP], data: log.data, topics: log.topics }).args as typeof args;
      } catch {
        continue;
      }
      const m = byPool.get(addr)!;
      const tokenIs0 = (await pairToken0(client, log.address as Address)) === m.token_address;
      const tokenOut = tokenIs0 ? args.amount0Out : args.amount1Out;
      const tokenIn = tokenIs0 ? args.amount0In : args.amount1In;
      const quoteIn = tokenIs0 ? args.amount1In : args.amount0In;
      const quoteOut = tokenIs0 ? args.amount1Out : args.amount0Out;
      const isBuy = tokenOut > 0n && quoteIn > 0n;
      const isSell = tokenIn > 0n && quoteOut > 0n;
      if (!isBuy && !isSell) continue;
      inserted += await insertActivity({
        marketId: m.id, type: isBuy ? "buy" : "sell", venue: "dex", wallet: lc(receipt.from), log, blockHash,
        amountIn: isBuy ? quoteIn : tokenIn, amountOut: isBuy ? tokenOut : quoteOut, quoteVolume: isBuy ? quoteIn : quoteOut, ts: blockTs,
      });
    }
  }
  return inserted;
}

/** Token addresses mentioned in the Portal's trade events of a receipt. */
function tokensInPortalLogs(receipt: TransactionReceipt): string[] {
  const out: string[] = [];
  for (const log of receipt.logs) {
    if (lc(log.address) !== lc(PORTAL_ADDRESS)) continue;
    try {
      const ev = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics });
      const args = ev.args as { token?: string };
      if (args.token) out.push(lc(args.token));
    } catch {
      /* not a Portal event we know */
    }
  }
  return out;
}
