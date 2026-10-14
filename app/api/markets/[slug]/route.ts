import { NextResponse } from "next/server";
import { getMarketBySlug } from "@/lib/database/queries";
import { handle, notFound } from "@/lib/errors/api";
import { isValidSlug } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle("markets/[slug]", async () => {
    const slug = decodeURIComponent((await params).slug).toLowerCase();
    if (!isValidSlug(slug)) throw notFound("No market exists for this business.");
    const market = await getMarketBySlug(slug);
    if (!market) throw notFound("No market exists for this business.");
    return NextResponse.json(market, { headers: { "Cache-Control": "public, max-age=5" } });
  });
}
