import "server-only";
import { getAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { withTransaction, isUniqueViolation } from "@/lib/database/pool";
import { decodeCurveTrade, parseTokenLaunched } from "@/lib/launch/receipt";
import { hasBytecode, readLaunchedToken, readLensState, readQuoteAsset, readTokenInfo, readTokenMeta } from "@/lib/market/onchain";
import { phaseFromStatus } from "@/lib/market/state";
import { PONS_FACTORY, PONS_LAUNCH_ROUTER, PONS_TOKEN_VERSION } from "@/lib/contracts/constants";
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
 * Verify a launch transaction entirely server-side and persist business → market → token.
 * Never trusts the client: the token comes from the Pons factory's TokenLaunched event in the mined
 * receipt, must be deployed by the intent's wallet, and its on-chain name, ticker, logo and website
 * (the business page URL) must equal what this launch intent reserved, and the creator fee must go
 * to the owner escrow at the site's fixed rate.
 * Used by POST /api/markets/confirm and by the indexer (recovery when the browser closed).
 */
export async function finalizeLaunch(client: PublicClient, intent: LaunchIntentRow, receipt: TransactionReceipt): Promise<FinalizedMarket> {
  if (receipt.status !== "success") throw new ApiError(400, "bad_request", "The launch transaction reverted on-chain.");

  const creatorLc = need(intent.creator_wallet, "intent.creator_wallet (database column)").toLowerCase();
  const to = receipt.to?.toLowerCase();
  if (to !== PONS_FACTORY.toLowerCase() && to !== PONS_LAUNCH_ROUTER.toLowerCase()) {
    throw new ApiError(400, "bad_request", "This transaction is not a market launch.");
  }
  if (need(receipt.from, "receipt.from").toLowerCase() !== creatorLc) {
    throw new ApiError(403, "forbidden", "The launch transaction was sent by a different wallet.");
  }
  const created = parseTokenLaunched(receipt);
  if (!created) throw new ApiError(400, "bad_request", "No market-creation event was found in this transaction.");
  if (created.deployer.toLowerCase() !== creatorLc) {
    throw new ApiError(403, "forbidden", "The market was launched for a different wallet.");
  }
  const tokenLc = created.token.toLowerCase();
  if (intent.predicted_token && intent.predicted_token.toLowerCase() !== tokenLc) {
    // The simulation predicted another address (e.g. launch terms changed between simulation and
    // mining). Identity is still proven by the checks below, so this is only logged.
    console.warn(`[finalizeLaunch] token ${tokenLc} differs from simulated ${intent.predicted_token}`);
  }
  if (!(await hasBytecode(client, created.token))) {
    throw new ApiError(502, "upstream_failed", "Token contract has no bytecode yet. Wait for another block and retry.");
  }

  const cfg = intent.config as {
    projectName?: string; description?: string; logoUrl?: string; website?: string; feeRecipient?: string; creatorFeeBps?: number;
  };
  const [lens, info, onchainMeta, launched] = await Promise.all([
    readLensState(client, created.token),
    readTokenInfo(client, created.token),
    readTokenMeta(client, created.token),
    readLaunchedToken(client, created.token),
  ]);
  const feeRecipientLc = need(cfg.feeRecipient, "intent.config.feeRecipient").toLowerCase();
  if (launched.creatorFeeRecipient.toLowerCase() !== feeRecipientLc || launched.creatorTaxBps !== cfg.creatorFeeBps) {
    throw new ApiError(400, "bad_request", "The launched token does not send the owner's share to the mapin owner escrow.");
  }
  if (info.name !== intent.token_name || info.symbol !== intent.symbol) {
    throw new ApiError(400, "bad_request", "The launched token name or ticker does not match this launch.");
  }
  if (cfg.logoUrl && onchainMeta.logo !== cfg.logoUrl) {
    throw new ApiError(400, "bad_request", "The launched token logo does not match this launch.");
  }
  if (cfg.website && onchainMeta.website !== cfg.website) {
    throw new ApiError(400, "bad_request", "The launched token is not bound to this business.");
  }
  const phase = phaseFromStatus(lens.status);
  if (phase === "unknown" || phase === "halted") {
    throw new ApiError(502, "upstream_failed", "The market is not tradable yet according to the chain. Retry shortly.");
  }
  const quote = await readQuoteAsset(client, getAddress(need(lens.quoteTokenAddress, "lens.quoteTokenAddress (on-chain read)")));
  const quoteLc = need(quote.address, "quote.address (on-chain read)").toLowerCase();
  const meta = await fetchTokenMetadata(intent.meta_cid);

  // The opening buy (if any) is part of the launch receipt: record it now; the indexer's
  // (tx_hash, log_index) uniqueness makes this idempotent.
  const buys = receipt.logs
    .map((log) => decodeCurveTrade(log, created.curve))
    .filter((t): t is NonNullable<typeof t> => t !== null && t.side === "buy");

  const txLc = receipt.transactionHash.toLowerCase();
  const blockHashLc = need(receipt.blockHash, "receipt.blockHash").toLowerCase();
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const blockTs = new Date(Number(block.timestamp) * 1000);

  try {
    return await withTransaction(async (c) => {
      const existing = await c.query<{ id: string; slug: string }>(
        `SELECT m.id, b.slug FROM markets m JOIN businesses b ON b.id = m.business_id WHERE m.token_address = $1`,
        [tokenLc],
      );
      if (existing.rows[0]) {
        const e = existing.rows[0];
        return { marketId: e.id, slug: e.slug, tokenAddress: created.token, txHash: receipt.transactionHash, alreadyRecorded: true };
      }
      const biz = await c.query<{ id: string; slug: string }>(`SELECT id, slug FROM businesses WHERE id = $1 FOR UPDATE`, [intent.business_id]);
      const r = biz.rows[0];
      if (!r) throw new ApiError(404, "not_found", "Business record not found.");
      const user = await c.query<{ id: string }>(`SELECT id FROM users WHERE wallet_address = $1`, [creatorLc]);
      if (!user.rows[0]) throw new ApiError(404, "not_found", "Creator account not found.");

      const inserted = await c.query<{ id: string }>(
        `INSERT INTO markets (business_id, creator_user_id, creator_wallet, fee_recipient, token_address, token_name, symbol, project_name,
                              description, meta_cid, image_cid, quote_token, quote_symbol, quote_decimals, token_version,
                              buy_tax_bps, sell_tax_bps, launch_tx, launch_block, status, price_raw, reserve_raw,
                              circulating_raw, total_supply_raw, progress_wad, stats_updated_at, created_at, curve_address)
         VALUES ($1,$2,$3,$27,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now(), $25, $26)
         RETURNING id`,
        [
          r.id, user.rows[0].id, creatorLc, tokenLc, info.name, info.symbol,
          cfg.projectName || info.name, cfg.description ?? meta?.description ?? null, intent.meta_cid,
          meta?.image ?? null, quoteLc, quote.symbol, quote.decimals, PONS_TOKEN_VERSION,
          Number(lens.buyTaxRate), Number(lens.sellTaxRate), txLc, receipt.blockNumber.toString(),
          phase === "graduated" ? "graduated" : "bonding", lens.price.toString(), lens.reserve.toString(),
          lens.circulatingSupply.toString(), info.totalSupply.toString(), lens.progress.toString(), blockTs,
          created.curve.toLowerCase(), feeRecipientLc,
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
          [marketId, b.wallet.toLowerCase(), txLc, b.logIndex, receipt.blockNumber.toString(), blockHashLc,
            b.amountIn.toString(), b.amountOut.toString(), b.fee.toString(), null, blockTs],
        );
      }
      await c.query(`UPDATE launch_intents SET consumed_at = now() WHERE id = $1`, [intent.id]);
      return { marketId, slug: r.slug, tokenAddress: created.token, txHash: receipt.transactionHash, alreadyRecorded: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, "markets_business_id_key")) {
      throw conflict("This business already has a market. The token you launched was not linked to it.");
    }
    throw err;
  }
}
