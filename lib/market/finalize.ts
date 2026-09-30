import "server-only";
import { getAddress, type Address, type Hex, type PublicClient, type TransactionReceipt, decodeEventLog } from "viem";
import { withTransaction, isUniqueViolation } from "@/lib/database/pool";
import { parseTokenCreated } from "@/lib/launch/receipt";
import { hasBytecode, readLensState, readQuoteAsset, readTokenInfo } from "@/lib/market/onchain";
import { phaseFromStatus } from "@/lib/market/state";
import { PORTAL_ADDRESS } from "@/lib/contracts/constants";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { fetchTokenMetadata } from "@/lib/metadata/upload";
import { ApiError, conflict } from "@/lib/errors/api";
import type { LaunchIntentRow } from "@/lib/database/queries";

export interface FinalizedMarket {
  marketId: string;
  slug: string;
  tokenAddress: Address;
  txHash: Hex;
  alreadyRecorded: boolean;
}

/**
 * Guard for values we call .toLowerCase() on. Instead of crashing with
 * "Cannot read properties of undefined", say exactly which value is missing.
 */
function need(v: unknown, name: string): string {
  if (typeof v !== "string" || v.length === 0) {
    console.error(`[finalizeLaunch] missing value: ${name}`, { got: v });
    throw new ApiError(502, "upstream_failed", `Launch could not be recorded: missing ${name}. Your token is safe on-chain; this can be retried after the fix.`);
  }
  return v;
}

/**
 * Verify a launch transaction entirely server-side and persist place → market → token.
 * Never trusts the client: the token address comes from the Portal's TokenCreated event in
 * the mined receipt, must equal the address reserved in the launch intent, must be created
 * by the intent's wallet with the intent's metadata, and must have deployed bytecode.
 * Used by POST /api/markets/confirm and by the indexer (recovery when the browser closed).
 */
export async function finalizeLaunch(client: PublicClient, intent: LaunchIntentRow, receipt: TransactionReceipt): Promise<FinalizedMarket> {
  if (receipt.status !== "success") throw new ApiError(400, "bad_request", "The launch transaction reverted on-chain.");

  const portalLc = need(PORTAL_ADDRESS, "PORTAL_ADDRESS (contract config)").toLowerCase();
  const creatorLc = need(intent.creator_wallet, "intent.creator_wallet (database column)").toLowerCase();
  const predictedLc = need(intent.predicted_token, "intent.predicted_token (database column)").toLowerCase();

  if (!receipt.to || receipt.to.toLowerCase() !== portalLc) {
    throw new ApiError(400, "bad_request", "This transaction is not a market launch.");
  }
  if (need(receipt.from, "receipt.from").toLowerCase() !== creatorLc) {
    throw new ApiError(403, "forbidden", "The launch transaction was sent by a different wallet.");
  }
  const created = parseTokenCreated(receipt);
  if (!created) throw new ApiError(400, "bad_request", "No market-creation event was found in this transaction.");
  const tokenLc = need(created.token, "created.token (TokenCreated event field)").toLowerCase();
  if (tokenLc !== predictedLc) {
    throw new ApiError(400, "bad_request", "The created token does not match the reserved token address.");
  }
  if (created.meta !== intent.meta_cid) throw new ApiError(400, "bad_request", "The launched token metadata does not match this launch.");
  if (!(await hasBytecode(client, created.token))) {
    throw new ApiError(502, "upstream_failed", "Token contract has no bytecode yet. Wait for another block and retry.");
  }

  const [lens, info] = await Promise.all([readLensState(client, created.token), readTokenInfo(client, created.token)]);
  const phase = phaseFromStatus(lens.status);
  if (phase !== "bonding" && phase !== "graduated") {
    throw new ApiError(502, "upstream_failed", "The market is not tradable yet according to the chain. Retry shortly.");
  }
  const quote = await readQuoteAsset(client, getAddress(need(lens.quoteTokenAddress, "lens.quoteTokenAddress (on-chain read)")));
  const quoteLc = need(quote.address, "quote.address (on-chain read)").toLowerCase();
  const meta = await fetchTokenMetadata(intent.meta_cid);
  const cfg = intent.config as { projectName?: string; description?: string };

  // Initial buy (if any) is part of the launch receipt: record it now; the indexer's
  // (tx_hash, log_index) uniqueness makes this idempotent.
  const buys: { logIndex: number; buyer: string; amount: bigint; eth: bigint; fee: bigint; postPrice: bigint; ts: bigint }[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== portalLc) continue;
    let a: Record<string, unknown>;
    try {
      const ev = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics, eventName: "TokenBought" });
      a = ev.args as unknown as Record<string, unknown>;
    } catch {
      continue; /* not a TokenBought */
    }
    const tok = a.token;
    if (typeof tok !== "string" || tok.toLowerCase() !== tokenLc) continue;
    // Field names differ between Portal versions: accept the common variants, fall back to the tx sender.
    const buyer = (a.buyer ?? a.account ?? a.user ?? a.trader ?? receipt.from) as unknown;
    const amount = a.amount as unknown;
    const eth = (a.eth ?? a.funds ?? a.cost ?? a.quoteAmount) as unknown;
    if (typeof buyer !== "string" || typeof amount !== "bigint" || typeof eth !== "bigint") {
      // Recording the initial buy is optional (the indexer picks it up later); never fail the launch over it.
      console.warn("[finalizeLaunch] skipping initial-buy record, unexpected TokenBought fields:", Object.keys(a));
      continue;
    }
    buys.push({
      logIndex: log.logIndex ?? 0,
      buyer,
      amount,
      eth,
      fee: typeof a.fee === "bigint" ? a.fee : 0n,
      postPrice: typeof a.postPrice === "bigint" ? a.postPrice : 0n,
      ts: typeof a.ts === "bigint" ? a.ts : created.timestamp,
    });
  }

  const txLc = receipt.transactionHash.toLowerCase();
  const blockHashLc = need(receipt.blockHash, "receipt.blockHash").toLowerCase();
  const blockTs = new Date(Number(created.timestamp) * 1000);

  try {
    return await withTransaction(async (c) => {
      const existing = await c.query<{ id: string; slug: string }>(
        `SELECT m.id, p.slug FROM markets m JOIN places p ON p.id = m.place_id WHERE m.token_address = $1`,
        [tokenLc],
      );
      if (existing.rows[0]) {
        const e = existing.rows[0];
        return { marketId: e.id, slug: e.slug, tokenAddress: created.token, txHash: receipt.transactionHash, alreadyRecorded: true };
      }
      const place = await c.query<{ id: string; slug: string }>(`SELECT id, slug FROM places WHERE id = $1 FOR UPDATE`, [intent.place_id]);
      const r = place.rows[0];
      if (!r) throw new ApiError(404, "not_found", "Place record not found.");
      const user = await c.query<{ id: string }>(`SELECT id FROM users WHERE wallet_address = $1`, [creatorLc]);
      if (!user.rows[0]) throw new ApiError(404, "not_found", "Creator account not found.");

      const inserted = await c.query<{ id: string }>(
        `INSERT INTO markets (place_id, creator_user_id, creator_wallet, fee_recipient, token_address, token_name, symbol, project_name,
                              description, meta_cid, image_cid, quote_token, quote_symbol, quote_decimals, token_version,
                              buy_tax_bps, sell_tax_bps, launch_tx, launch_block, status, price_raw, reserve_raw,
                              circulating_raw, total_supply_raw, progress_wad, stats_updated_at, created_at)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now(), $25)
         RETURNING id`,
        [
          r.id, user.rows[0].id, creatorLc, tokenLc, created.name, created.symbol,
          cfg.projectName || created.name, cfg.description ?? meta?.description ?? null, intent.meta_cid,
          meta?.image ?? null, quoteLc, quote.symbol, quote.decimals, lens.tokenVersion,
          Number(lens.buyTaxRate), Number(lens.sellTaxRate), txLc, receipt.blockNumber.toString(),
          phase === "graduated" ? "graduated" : "bonding", lens.price.toString(), lens.reserve.toString(),
          lens.circulatingSupply.toString(), info.totalSupply.toString(), lens.progress.toString(), blockTs,
        ],
      );
      const marketId = inserted.rows[0]!.id;
      await c.query(
        `INSERT INTO activity (market_id, type, venue, wallet, tx_hash, log_index, block_number, block_hash, "timestamp")
         VALUES ($1,'launch','curve',$2,$3,$4,$5,$6,$7) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [marketId, creatorLc, txLc, created.logIndex, receipt.blockNumber.toString(), blockHashLc, blockTs],
      );
      for (const b of buys) {
        await c.query(
          `INSERT INTO activity (market_id, type, venue, wallet, tx_hash, log_index, block_number, block_hash, amount_in,
                                 amount_out, quote_volume, fee, post_price, "timestamp")
           VALUES ($1,'buy','curve',$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,$11) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
          [marketId, b.buyer.toLowerCase(), txLc, b.logIndex, receipt.blockNumber.toString(), blockHashLc,
            b.eth.toString(), b.amount.toString(), b.fee.toString(), b.postPrice.toString(), new Date(Number(b.ts) * 1000)],
        );
      }
      await c.query(`UPDATE launch_intents SET consumed_at = now() WHERE id = $1`, [intent.id]);
      return { marketId, slug: r.slug, tokenAddress: created.token, txHash: receipt.transactionHash, alreadyRecorded: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, "markets_place_id_key")) {
      throw conflict("This place already has a market. The token you launched was not linked to it.");
    }
    throw err;
  }
}
