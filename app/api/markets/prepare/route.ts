import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession } from "@/lib/auth/session";
import { getBusinessById, upsertUserByWallet } from "@/lib/database/queries";
import { withTransaction } from "@/lib/database/pool";
import { handle, readJson, assertSameOrigin, conflict, badRequest, notFound } from "@/lib/errors/api";
import { appOrigin, ConfigError } from "@/lib/config/server";
import { OWNER_ESCROW_ADDRESS, OWNER_FEE_BPS } from "@/lib/config/public";
import { rateLimit } from "@/lib/security/rate-limit";
import { isCid } from "@/lib/metadata/validate";
import { marketPath, normalizeAddress, normalizeSymbol, normalizeTokenName, isHexAddress } from "@/lib/validation/normalize";
import { serverPublicClient } from "@/lib/chain/server-client";
import { hasBytecode } from "@/lib/market/onchain";
import { isAcceptedPair } from "@/lib/market/pairs";

export const dynamic = "force-dynamic";

const INTENT_TTL_MINUTES = 30;

const body = z.object({
  businessId: z.uuid(),
  description: z.string().trim().min(1).max(1000),
  tokenName: z.string(),
  symbol: z.string(),
  metaCid: z.string().refine(isCid, "Invalid metadata CID"),
  salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  /** token address returned by the launch simulation in the browser (informational) */
  predictedToken: z.string().optional(),
  logoUrl: z.string().max(512),
  imageCid: z.string().refine(isCid, "Invalid image CID"),
  creatorFeeBps: z.number().int(),
  feeRecipient: z.string(),
  quoteToken: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Last server gate before the wallet is asked to sign:
 *  - the business exists, is visible and has no market yet; no other wallet's launch is in flight,
 *  - the owner's share and its recipient are exactly the site's (escrow until the owner claims),
 *  - the pair asset is supported and the on-chain logo URL is the canonical one,
 *  - reserves the launch in an intent the confirm step (and the indexer) verify the receipt against.
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

    if (!isHexAddress(OWNER_ESCROW_ADDRESS)) {
      throw new ConfigError("NEXT_PUBLIC_OWNER_ESCROW_ADDRESS is not set. See README → Owner escrow.");
    }
    if (b.feeRecipient.toLowerCase() !== OWNER_ESCROW_ADDRESS || b.creatorFeeBps !== OWNER_FEE_BPS) {
      throw badRequest("The owner's share must go to the mapin owner escrow. Reload the page and try again.");
    }

    const business = await getBusinessById(b.businessId);
    if (!business || business.hidden) throw notFound("Business not found.");

    const client = serverPublicClient();
    if (!(await isAcceptedPair(client, quoteToken))) throw badRequest("The selected pair asset is not accepted by the launch contract right now.");
    const expectedLogo = `${appOrigin().origin}/api/ipfs/${b.imageCid}`;
    if (b.logoUrl !== expectedLogo) throw badRequest("Logo URL is not the canonical mapin logo URL. Re-upload the logo.");
    let predicted: string | null = null;
    if (b.predictedToken) {
      if (!isHexAddress(b.predictedToken)) throw badRequest("Invalid simulated token address.");
      predicted = b.predictedToken.toLowerCase();
      if (await hasBytecode(client, predicted as `0x${string}`)) throw badRequest("A contract already exists at the simulated address. Retry the launch.");
    }

    await upsertUserByWallet(session.wallet_address);
    const website = `${appOrigin().origin}${marketPath(business.slug)}`;

    const intentId = await withTransaction(async (c) => {
      // serialise concurrent prepares for the same business
      await c.query(`SELECT id FROM businesses WHERE id = $1 FOR UPDATE`, [business.id]);
      const market = await c.query<{ symbol: string }>(`SELECT symbol FROM markets WHERE business_id = $1`, [business.id]);
      if (market.rows[0]) {
        throw conflict(`${business.name} is already tokenized ($${market.rows[0].symbol}).`, { marketPath: marketPath(business.slug) });
      }
      const other = await c.query<{ expires_at: Date }>(
        `SELECT expires_at FROM launch_intents
         WHERE business_id = $1 AND consumed_at IS NULL AND expires_at > now() AND creator_wallet <> $2 LIMIT 1`,
        [business.id, session.wallet_address],
      );
      if (other.rows[0]) {
        const mins = Math.max(1, Math.ceil((other.rows[0].expires_at.getTime() - Date.now()) / 60_000));
        throw conflict(`Someone else is tokenizing ${business.name} right now. Try again in ${mins} min.`);
      }
      await c.query(
        `UPDATE launch_intents SET expires_at = now() WHERE business_id = $1 AND creator_wallet = $2 AND consumed_at IS NULL`,
        [business.id, session.wallet_address],
      );
      const ins = await c.query<{ id: string }>(
        `INSERT INTO launch_intents (business_id, creator_wallet, predicted_token, meta_cid, token_name, symbol, quote_token, config, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9)) RETURNING id`,
        [business.id, session.wallet_address, predicted, b.metaCid, tokenName, symbol, quoteToken,
          JSON.stringify({
            ...b.config, projectName: business.name, description: b.description, salt: b.salt,
            logoUrl: b.logoUrl, imageCid: b.imageCid, website, creatorFeeBps: b.creatorFeeBps, feeRecipient: OWNER_ESCROW_ADDRESS,
          }),
          INTENT_TTL_MINUTES],
      );
      return ins.rows[0]!.id;
    });

    return NextResponse.json({ intentId, website, expiresInMinutes: INTENT_TTL_MINUTES });
  });
}
