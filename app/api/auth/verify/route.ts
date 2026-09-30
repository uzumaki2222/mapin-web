import { NextResponse } from "next/server";
import { z } from "zod";
import { parseSiweMessage } from "viem/siwe";
import { getSession, updateSession } from "@/lib/auth/session";
import { queryOne } from "@/lib/database/pool";
import { handle, readJson, unauthorized, badRequest, assertSameOrigin } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { serverPublicClient } from "@/lib/chain/server-client";
import { upsertUserByWallet } from "@/lib/database/queries";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { BSC_CHAIN_ID } from "@/lib/contracts/constants";
import { normalizeAddress } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";

const body = z.object({
  message: z.string().min(50).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const MAX_VALIDITY_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  return handle("auth/verify", async () => {
    const origin = appOrigin();
    assertSameOrigin(req, origin);
    await rateLimit(`verify:${clientIp(req)}`, 20, 60);
    const { message, signature } = body.parse(await readJson(req));
    const session = await getSession();
    if (!session) throw unauthorized("Session expired. Reload the page and sign again.");

    const fields = parseSiweMessage(message);
    if (!fields.address || !fields.nonce || !fields.domain || !fields.uri) throw badRequest("Malformed sign-in message");
    // Domain binding: the message must be for this exact site and chain.
    if (fields.domain !== origin.host) throw badRequest(`Sign-in message is for ${fields.domain}, expected ${origin.host}`);
    if (new URL(fields.uri).origin !== origin.origin) throw badRequest("Sign-in message URI does not match this site");
    if (fields.chainId !== BSC_CHAIN_ID) throw badRequest("Sign-in message must be for BNB Smart Chain (chain 56)");
    if (!fields.expirationTime || !fields.issuedAt) throw badRequest("Sign-in message must include issue and expiration times");
    if (fields.expirationTime.getTime() - fields.issuedAt.getTime() > MAX_VALIDITY_MS) throw badRequest("Sign-in message validity is too long");

    // Single-use nonce bound to this browser session.
    const nonce = await queryOne<{ nonce: string }>(
      `UPDATE auth_nonces SET used_at = now()
       WHERE nonce = $1 AND session_id = $2 AND used_at IS NULL AND expires_at > now() RETURNING nonce`,
      [fields.nonce, session.id],
    );
    if (!nonce) throw unauthorized("Sign-in request expired or was already used. Try again.");

    // Verifies signature (EOA and ERC-1271/6492 smart accounts), domain, nonce and time window.
    const valid = await serverPublicClient().verifySiweMessage({
      message,
      signature: signature as `0x${string}`,
      domain: origin.host,
      nonce: fields.nonce,
    });
    if (!valid) throw unauthorized("Wallet signature could not be verified.");

    const wallet = normalizeAddress(fields.address);
    await upsertUserByWallet(wallet);
    await updateSession(session.id, { wallet_address: wallet, wallet_verified_at: new Date() });
    return NextResponse.json({ wallet });
  });
}
