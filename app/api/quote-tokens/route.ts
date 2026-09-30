import { NextResponse } from "next/server";
import { serverPublicClient } from "@/lib/chain/server-client";
import { readEnabledQuoteAssets, readProtocolFeeRate, type QuoteAsset } from "@/lib/market/onchain";
import { handle, ApiError } from "@/lib/errors/api";

export const dynamic = "force-dynamic";

let cache: { at: number; assets: QuoteAsset[]; fee: { buyBps: string; sellBps: string } | null } | null = null;
const TTL = 60_000;

/** Pair assets currently enabled on-chain + live protocol trading fee. */
export async function GET() {
  return handle("quote-tokens", async () => {
    if (!cache || Date.now() - cache.at > TTL) {
      try {
        const client = serverPublicClient();
        const [assets, fee] = await Promise.all([readEnabledQuoteAssets(client), readProtocolFeeRate(client)]);
        cache = { at: Date.now(), assets, fee: fee ? { buyBps: fee.buyBps.toString(), sellBps: fee.sellBps.toString() } : null };
      } catch (err) {
        if (cache) return NextResponse.json({ ...cache, stale: true });
        throw new ApiError(502, "upstream_failed", "BNB Chain RPC is unavailable — could not read supported pairs.", String(err));
      }
    }
    return NextResponse.json(cache, { headers: { "Cache-Control": "public, max-age=30" } });
  });
}
