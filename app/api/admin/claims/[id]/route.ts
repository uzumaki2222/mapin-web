import { NextResponse } from "next/server";
import { z } from "zod";
import { queryOne } from "@/lib/database/pool";
import { withTransaction } from "@/lib/database/pool";
import { handle, readJson, notFound, conflict } from "@/lib/errors/api";
import { requireAdmin } from "@/lib/claims/admin";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["approve", "reject"]) });

/**
 * Approve: the business is marked as claimed by the claim's wallet (other open claims are rejected).
 * Moving the escrowed fees and switching the token's fee recipient is done by the escrow holder —
 * see README → Owner escrow.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("admin/claims", async () => {
    requireAdmin(req);
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw notFound("Claim not found.");
    const b = body.parse(await readJson(req));
    const claim = await queryOne<{ id: string; business_id: string; wallet: string }>(`SELECT id, business_id, wallet FROM claims WHERE id = $1`, [id.data]);
    if (!claim) throw notFound("Claim not found.");
    if (b.action === "reject") {
      await queryOne(`UPDATE claims SET status = 'rejected', decided_at = now() WHERE id = $1 RETURNING id`, [claim.id]);
      return NextResponse.json({ ok: true });
    }
    await withTransaction(async (c) => {
      const biz = await c.query<{ claimed_wallet: string | null }>(`SELECT claimed_wallet FROM businesses WHERE id = $1 FOR UPDATE`, [claim.business_id]);
      if (biz.rows[0]?.claimed_wallet && biz.rows[0].claimed_wallet !== claim.wallet) throw conflict("Business is already claimed by another wallet.");
      await c.query(`UPDATE businesses SET claimed_wallet = $2, claimed_at = now(), updated_at = now() WHERE id = $1`, [claim.business_id, claim.wallet]);
      await c.query(`UPDATE claims SET status = 'approved', decided_at = now() WHERE id = $1`, [claim.id]);
      await c.query(`UPDATE claims SET status = 'rejected', decided_at = now() WHERE business_id = $1 AND id <> $2 AND status IN ('pending','dns_verified')`, [claim.business_id, claim.id]);
    });
    return NextResponse.json({ ok: true });
  });
}
