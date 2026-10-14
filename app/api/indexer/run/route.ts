import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/server";
import { indexerPublicClient, serverPublicClient } from "@/lib/chain/server-client";
import { runIndexerPass, refreshMarketStats } from "@/lib/indexer/run";
import { handle, ApiError } from "@/lib/errors/api";
import { safeEqual } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cron entry point: POST with header `Authorization: Bearer <INDEXER_SECRET>`. */
export async function POST(req: Request) {
  return handle("indexer/run", async () => {
    const secret = serverEnv().INDEXER_SECRET;
    if (!secret) throw new ApiError(404, "not_found", "Indexer endpoint is disabled (INDEXER_SECRET not set).");
    const auth = req.headers.get("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${secret}`)) throw new ApiError(401, "unauthorized", "Invalid indexer secret.");
    const started = Date.now();
    const passes = [];
    const client = indexerPublicClient();
    while (Date.now() - started < 40_000) {
      const r = await runIndexerPass(client);
      passes.push({ ...r, from: r.from?.toString() ?? null, to: r.to?.toString() ?? null, head: r.head.toString(), reorgRewoundTo: r.reorgRewoundTo?.toString() });
      if (r.caughtUp || r.skipped) break;
    }
    const refreshed = await refreshMarketStats(serverPublicClient(), 25);
    return NextResponse.json({ passes, refreshed });
  });
}
