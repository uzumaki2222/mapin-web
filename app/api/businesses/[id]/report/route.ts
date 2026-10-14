import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/database/pool";
import { getBusinessById } from "@/lib/database/queries";
import { handle, readJson, assertSameOrigin, notFound } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const body = z.object({
  reason: z.string().trim().min(5, "Tell us briefly why").max(2000),
  contact: z.string().trim().max(200).optional().transform((v) => v || null),
});

/** Anyone (usually the real owner) can ask for a business page to be hidden. Reviewed by an admin. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("businesses/report", async () => {
    assertSameOrigin(req, appOrigin());
    await rateLimit(`report:${clientIp(req)}`, 10, 60 * 60);
    const id = z.uuid().safeParse((await params).id);
    if (!id.success || !(await getBusinessById(id.data))) throw notFound("Business not found.");
    const b = body.parse(await readJson(req));
    await query(`INSERT INTO reports (business_id, reason, contact) VALUES ($1, $2, $3)`, [id.data, b.reason, b.contact]);
    return NextResponse.json({ ok: true });
  });
}
