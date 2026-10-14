import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession, getSession } from "@/lib/auth/session";
import { queryOne } from "@/lib/database/pool";
import { getBusinessById } from "@/lib/database/queries";
import { handle, readJson, assertSameOrigin, badRequest, notFound, conflict } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { randomToken } from "@/lib/security/crypto";
import { websiteDomain } from "@/lib/validation/normalize";
import { toClaimInfo, type ClaimRow } from "@/lib/claims/info";

export const dynamic = "force-dynamic";

/** The signed-in wallet's claim on a business, if any. */
export async function GET(req: Request) {
  return handle("claims", async () => {
    const id = z.uuid().safeParse(new URL(req.url).searchParams.get("businessId"));
    if (!id.success) throw badRequest("businessId is required");
    const s = await getSession();
    if (!s?.wallet_address) return NextResponse.json({ claim: null });
    const row = await queryOne<ClaimRow>(`SELECT id, domain, domain_matches, token, status FROM claims WHERE business_id = $1 AND wallet = $2`, [id.data, s.wallet_address]);
    return NextResponse.json({ claim: row ? toClaimInfo(row) : null }, { headers: { "Cache-Control": "no-store" } });
  });
}

const body = z.object({
  businessId: z.uuid(),
  domain: z.string().trim().min(3).max(200),
  contact: z.string().trim().max(200).optional().transform((v) => v || null),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

/** Start (or restart) an owner claim: returns the DNS TXT record the owner must publish. */
export async function POST(req: Request) {
  return handle("claims/create", async () => {
    assertSameOrigin(req, appOrigin());
    const session = await requireWalletSession();
    await rateLimit(`claim:${session.wallet_address}`, 10, 60 * 60);
    const b = body.parse(await readJson(req));
    const business = await getBusinessById(b.businessId);
    if (!business) throw notFound("Business not found.");
    if (business.claimed_wallet) throw conflict("This business has already been claimed.");
    const domain = websiteDomain(b.domain);
    if (!domain) throw badRequest("Enter your business website domain, e.g. warungsarirasa.com");
    const onRecord = websiteDomain(business.website);
    const matches = onRecord !== null && onRecord === domain;
    const row = await queryOne<ClaimRow>(
      `INSERT INTO claims (business_id, wallet, domain, domain_matches, token, contact, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_id, wallet) DO UPDATE SET
         domain = EXCLUDED.domain, domain_matches = EXCLUDED.domain_matches, contact = EXCLUDED.contact, note = EXCLUDED.note,
         token = CASE WHEN claims.domain = EXCLUDED.domain THEN claims.token ELSE EXCLUDED.token END,
         status = CASE WHEN claims.status = 'approved' THEN claims.status ELSE 'pending' END,
         verified_at = NULL
       RETURNING id, domain, domain_matches, token, status`,
      [business.id, session.wallet_address, domain, matches, randomToken(16), b.contact, b.note],
    );
    return NextResponse.json({ claim: toClaimInfo(row!) });
  });
}
