import { NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne } from "@/lib/database/pool";
import { handle, readJson, notFound } from "@/lib/errors/api";
import { requireAdmin } from "@/lib/claims/admin";

export const dynamic = "force-dynamic";

const body = z.object({
  hidden: z.boolean(),
  reason: z.string().trim().max(300).optional().transform((v) => v || null),
});

/** Hide / unhide a business (pins, lists and page). Resolves its open takedown requests. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("admin/businesses", async () => {
    requireAdmin(req);
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw notFound("Business not found.");
    const b = body.parse(await readJson(req));
    const row = await queryOne(`UPDATE businesses SET hidden = $2, hidden_reason = $3, updated_at = now() WHERE id = $1 RETURNING id`, [id.data, b.hidden, b.reason]);
    if (!row) throw notFound("Business not found.");
    await query(`UPDATE reports SET resolved_at = now() WHERE business_id = $1 AND resolved_at IS NULL`, [id.data]);
    return NextResponse.json({ ok: true });
  });
}
