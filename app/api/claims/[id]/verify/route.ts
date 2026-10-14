import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession } from "@/lib/auth/session";
import { queryOne } from "@/lib/database/pool";
import { handle, assertSameOrigin, notFound } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { hasVerificationRecord } from "@/lib/claims/dns";
import { toClaimInfo, type ClaimRow } from "@/lib/claims/info";

export const dynamic = "force-dynamic";

/** Checks the owner's DNS TXT record. A verified claim then waits for an admin to approve the payout. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("claims/verify", async () => {
    assertSameOrigin(req, appOrigin());
    const session = await requireWalletSession();
    await rateLimit(`claim-verify:${session.wallet_address}`, 30, 60 * 60);
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw notFound("Claim not found.");
    const row = await queryOne<ClaimRow>(
      `SELECT id, domain, domain_matches, token, status FROM claims WHERE id = $1 AND wallet = $2`,
      [id.data, session.wallet_address],
    );
    if (!row) throw notFound("Claim not found.");
    if (row.status !== "pending") return NextResponse.json({ claim: toClaimInfo(row), found: row.status !== "rejected" });
    const found = await hasVerificationRecord(row.domain, row.token);
    if (!found) return NextResponse.json({ claim: toClaimInfo(row), found: false });
    const updated = await queryOne<ClaimRow>(
      `UPDATE claims SET status = 'dns_verified', verified_at = now() WHERE id = $1 RETURNING id, domain, domain_matches, token, status`,
      [row.id],
    );
    return NextResponse.json({ claim: toClaimInfo(updated!), found: true });
  });
}
