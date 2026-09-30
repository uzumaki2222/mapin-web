import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/osm/client";
import { handle } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const qp = z.object({ q: z.string().trim().min(2).max(120) });

/** Worldwide place search: countries, states, cities, towns, villages, neighbourhoods (OpenStreetMap). */
export async function GET(req: Request) {
  return handle("places/search", async () => {
    await rateLimit(`search:${clientIp(req)}`, 40, 60);
    const p = qp.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const items = await searchPlaces(p.q);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=600" } });
  });
}
