import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { getOrCreateSession } from "@/lib/auth/session";
import { query } from "@/lib/database/pool";
import { handle } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { appOrigin } from "@/lib/config/server";
import { BSC_CHAIN_ID } from "@/lib/contracts/constants";

export const dynamic = "force-dynamic";

const NONCE_TTL_SECONDS = 10 * 60;

export async function GET(req: Request) {
  return handle("auth/nonce", async () => {
    await rateLimit(`nonce:${clientIp(req)}`, 30, 60);
    const session = await getOrCreateSession();
    const nonce = generateSiweNonce();
    await query(
      `INSERT INTO auth_nonces (nonce, session_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [nonce, session.id, NONCE_TTL_SECONDS],
    );
    const origin = appOrigin();
    return NextResponse.json({ nonce, domain: origin.host, uri: origin.origin, chainId: BSC_CHAIN_ID, ttlSeconds: NONCE_TTL_SECONDS });
  });
}
