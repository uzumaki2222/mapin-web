import { NextResponse } from "next/server";
import { query } from "@/lib/database/pool";
import { handle } from "@/lib/errors/api";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Open reports for the /admin page. */
export async function GET(req: Request) {
  return handle("admin/overview", async () => {
    requireAdmin(req);
    const reports = await query(
      `SELECT r.id, r.reason, r.contact, r.created_at, p.id AS place_id, p.name, p.slug, p.hidden, m.symbol
       FROM reports r JOIN places p ON p.id = r.place_id LEFT JOIN markets m ON m.place_id = p.id
       WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 200`,
    );
    return NextResponse.json({ reports }, { headers: { "Cache-Control": "no-store" } });
  });
}
