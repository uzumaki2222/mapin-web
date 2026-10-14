import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketBySlug, listActivity } from "@/lib/database/queries";
import { handle, notFound } from "@/lib/errors/api";
import { isValidSlug } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";

const qp = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.iso.datetime().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle("markets/activity", async () => {
    const slug = decodeURIComponent((await params).slug).toLowerCase();
    if (!isValidSlug(slug)) throw notFound("No market exists for this business.");
    const market = await getMarketBySlug(slug);
    if (!market) throw notFound("No market exists for this business.");
    const p = qp.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const items = await listActivity(market.id, p.limit, p.before ? new Date(p.before) : undefined);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=5" } });
  });
}
