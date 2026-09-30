import { NextResponse } from "next/server";
import { z } from "zod";
import { listRecentTrades } from "@/lib/database/queries";
import { handle } from "@/lib/errors/api";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const qp = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function GET(req: Request) {
  return handle("activity/recent", async () => {
    await rateLimit(`activity-recent:${clientIp(req)}`, 240, 60);
    const p = qp.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const items = await listRecentTrades(p.limit);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=3, stale-while-revalidate=10" } });
  });
}
