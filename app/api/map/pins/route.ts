import { NextResponse, after } from "next/server";
import { indexIfDue } from "@/lib/indexer/auto";
import { z } from "zod";
import { listMapPins } from "@/lib/database/queries";
import { handle } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const qp = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/)
    .transform((s) => s.split(",").map(Number) as [number, number, number, number])
    .refine(([w, s, e, n]) => [w, e].every((x) => x >= -180 && x <= 180) && [s, n].every((y) => y >= -90 && y <= 90) && s <= n, "Invalid bbox")
    .optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
});

/** Tokenized places for the map layer (everywhere, or inside ?bbox=west,south,east,north). */
export async function GET(req: Request) {
  return handle("map/pins", async () => {
    await rateLimit(`pins:${clientIp(req)}`, 240, 60);
    after(indexIfDue);
    const p = qp.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const items = await listMapPins(p.bbox ?? null, p.limit);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=60" } });
  });
}
