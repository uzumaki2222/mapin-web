import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/osm/client";
import { handle } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const qp = z.object({
  q: z.string().trim().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** Worldwide search: businesses, streets, neighbourhoods, cities and countries (OpenStreetMap). */
export async function GET(req: Request) {
  return handle("places/search", async () => {
    await rateLimit(`search:${clientIp(req)}`, 40, 60);
    const p = qp.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const lang = (req.headers.get("accept-language") ?? "en").split(",")[0]!.slice(0, 16) || "en";
    const near = p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : null;
    const items = await searchPlaces(p.q, near, lang);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=300" } });
  });
}
