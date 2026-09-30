import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlaceById } from "@/lib/database/queries";
import { placeOutline } from "@/lib/osm/client";
import { handle, notFound } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** Simplified border of a place (GeoJSON geometry) for drawing on the map. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("places/outline", async () => {
    await rateLimit(`outline:${clientIp(req)}`, 60, 60);
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw notFound("Place not found.");
    const row = await getPlaceById(id.data);
    if (!row) throw notFound("Place not found.");
    const geometry = await placeOutline(row.source_id);
    return NextResponse.json({ geometry }, { headers: { "Cache-Control": "public, max-age=86400" } });
  });
}
