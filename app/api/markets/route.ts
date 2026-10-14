import { NextResponse } from "next/server";
import { z } from "zod";
import { listMarkets } from "@/lib/database/queries";
import { handle } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const params = z.object({
  section: z.enum(["trending", "new", "graduated", "all"]).default("all"),
  status: z.enum(["bonding", "graduated"]).optional(),
  quote: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function GET(req: Request) {
  return handle("markets", async () => {
    await rateLimit(`markets:${clientIp(req)}`, 240, 60);
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
    const p = params.parse(sp);
    const out = await listMarkets(p);
    return NextResponse.json(out, { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=30" } });
  });
}
