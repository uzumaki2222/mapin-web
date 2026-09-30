import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession } from "@/lib/auth/session";
import { getPlaceById, upsertUserByWallet } from "@/lib/database/queries";
import { withTransaction } from "@/lib/database/pool";
import { handle, readJson, assertSameOrigin, conflict, badRequest, notFound } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { predictTokenAddress } from "@/lib/launch/salt";
import { vanityTargetFor } from "@/lib/launch/params";
import { isCid } from "@/lib/metadata/validate";
import { marketPath, normalizeAddress, normalizeSymbol, normalizeTokenName } from "@/lib/validation/normalize";
import { serverPublicClient } from "@/lib/chain/server-client";
import { readEnabledQuoteAssets, hasBytecode } from "@/lib/market/onchain";

export const dynamic = "force-dynamic";

const INTENT_TTL_MINUTES = 30;

const body = z.object({
  placeId: z.uuid(),
  description: z.string().trim().min(1).max(1000),
  tokenName: z.string(),
  symbol: z.string(),
  metaCid: z.string().refine(isCid, "Invalid metadata CID"),
  salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  isTax: z.boolean(),
  quoteToken: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Last server gate before the wallet is asked to sign:
 *  - the place exists, is visible and has no market yet; no other wallet's launch is in flight,
 *  - the pair asset is enabled on-chain right now,
 *  - recomputes the CREATE2 token address from the salt and reserves it in a launch intent.
 */
export async function POST(req: Request) {
  return handle("markets/prepare", async () => {
    assertSameOrigin(req, appOrigin());
    const session = await requireWalletSession();
    await rateLimit(`prepare:${session.wallet_address}`, 20, 60 * 60);
    const b = body.parse(await readJson(req));
    const tokenName = normalizeTokenName(b.tokenName);
    const symbol = normalizeSymbol(b.symbol);
    const quoteToken = normalizeAddress(b.quoteToken);

    const place = await getPlaceById(b.placeId);
    if (!place || place.hidden) throw notFound("Place not found.");

    const client = serverPublicClient();
    const enabled = await readEnabledQuoteAssets(client);
    if (!enabled.some((q) => q.address.toLowerCase() === quoteToken)) throw badRequest("The selected pair asset is not enabled on-chain.");

    const { tokenImpl, suffix } = vanityTargetFor(b.isTax);
    const predicted = predictTokenAddress(tokenImpl, b.salt as `0x${string}`);
    if (!predicted.toLowerCase().endsWith(suffix)) throw badRequest("Generated token address is invalid. Regenerate and retry.");
    if (await hasBytecode(client, predicted)) throw badRequest("A contract already exists at the generated address. Regenerate and retry.");

    await upsertUserByWallet(session.wallet_address);

    const intentId = await withTransaction(async (c) => {
      // serialise concurrent prepares for the same place
      await c.query(`SELECT id FROM places WHERE id = $1 FOR UPDATE`, [place.id]);
      const market = await c.query<{ symbol: string }>(`SELECT symbol FROM markets WHERE place_id = $1`, [place.id]);
      if (market.rows[0]) {
        throw conflict(`${place.name} is already tokenized ($${market.rows[0].symbol}).`, { marketPath: marketPath(place.slug) });
      }
      const other = await c.query<{ expires_at: Date }>(
        `SELECT expires_at FROM launch_intents
         WHERE place_id = $1 AND consumed_at IS NULL AND expires_at > now() AND creator_wallet <> $2 LIMIT 1`,
        [place.id, session.wallet_address],
      );
      if (other.rows[0]) {
        const mins = Math.max(1, Math.ceil((other.rows[0].expires_at.getTime() - Date.now()) / 60_000));
        throw conflict(`Someone else is launching ${place.name} right now. Try again in ${mins} min.`);
      }
      await c.query(
        `UPDATE launch_intents SET expires_at = now() WHERE place_id = $1 AND creator_wallet = $2 AND consumed_at IS NULL`,
        [place.id, session.wallet_address],
      );
      const ins = await c.query<{ id: string }>(
        `INSERT INTO launch_intents (place_id, creator_wallet, predicted_token, meta_cid, token_name, symbol, quote_token, config, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9)) RETURNING id`,
        [place.id, session.wallet_address, predicted.toLowerCase(), b.metaCid, tokenName, symbol, quoteToken,
          JSON.stringify({ ...b.config, projectName: place.name, description: b.description, isTax: b.isTax, salt: b.salt }),
          INTENT_TTL_MINUTES],
      );
      return ins.rows[0]!.id;
    });

    return NextResponse.json({ intentId, predictedToken: predicted, expiresInMinutes: INTENT_TTL_MINUTES });
  });
}
