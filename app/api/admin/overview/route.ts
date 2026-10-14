import { NextResponse } from "next/server";
import { query } from "@/lib/database/pool";
import { handle } from "@/lib/errors/api";
import { requireAdmin } from "@/lib/claims/admin";

export const dynamic = "force-dynamic";

/** Open claims and takedown requests for the /admin page. */
export async function GET(req: Request) {
  return handle("admin/overview", async () => {
    requireAdmin(req);
    const claims = await query(
      `SELECT c.id, c.wallet, c.domain, c.domain_matches, c.status, c.contact, c.note, c.created_at, c.verified_at,
              b.id AS business_id, b.name, b.slug, b.website, b.claimed_wallet, m.symbol, m.token_address, m.fee_recipient
       FROM claims c JOIN businesses b ON b.id = c.business_id LEFT JOIN markets m ON m.business_id = b.id
       WHERE c.status IN ('pending','dns_verified') ORDER BY (c.status = 'dns_verified') DESC, c.created_at DESC LIMIT 200`,
    );
    const reports = await query(
      `SELECT r.id, r.reason, r.contact, r.created_at, b.id AS business_id, b.name, b.slug, b.hidden
       FROM reports r JOIN businesses b ON b.id = r.business_id WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 200`,
    );
    return NextResponse.json({ claims, reports }, { headers: { "Cache-Control": "no-store" } });
  });
}
