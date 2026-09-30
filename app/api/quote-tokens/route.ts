import { NextResponse } from "next/server";
import { serverPublicClient } from "@/lib/chain/server-client";
import { readLaunchTerms, type QuoteAsset } from "@/lib/market/onchain";
import { listPairAssets } from "@/lib/market/pairs";
import { handle, ApiError } from "@/lib/errors/api";
import { CHAIN_NAME } from "@/lib/contracts/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the first pair-asset discovery scans the factory history

interface Payload {
  at: number;
  assets: QuoteAsset[];
  /** bonding-curve trading fee (same on buys and sells) */
  fee: { buyBps: string; sellBps: string } | null;
  launch: { launchFee: string; graduationThreshold: string; maxCreatorTaxBps: string; supply: string; enabled: boolean } | null;
}

let cache: Payload | null = null;
const TTL = 60_000;

/**
 * Pair assets accepted by the launch factory right now (ETH + approved Robinhood stock tokens / USDG,
 * discovered on-chain) and the live launch terms (launch fee, curve fee, ETH graduation threshold).
 */
export async function GET() {
  return handle("quote-tokens", async () => {
    if (!cache || Date.now() - cache.at > TTL) {
      try {
        const client = serverPublicClient();
        const [assets, terms] = await Promise.all([listPairAssets(client), readLaunchTerms(client)]);
        cache = {
          at: Date.now(),
          assets,
          fee: { buyBps: terms.curveFeeBps.toString(), sellBps: terms.curveFeeBps.toString() },
          launch: {
            launchFee: terms.launchFee.toString(),
            graduationThreshold: terms.graduationThreshold.toString(),
            maxCreatorTaxBps: terms.maxCreatorTaxBps.toString(),
            supply: terms.supply.toString(),
            enabled: terms.launchEnabled && terms.configEnabled,
          },
        };
      } catch (err) {
        if (cache) return NextResponse.json({ ...cache, stale: true });
        throw new ApiError(502, "upstream_failed", `${CHAIN_NAME} RPC is unavailable — could not read launch terms.`, String(err));
      }
    }
    return NextResponse.json(cache, { headers: { "Cache-Control": "public, max-age=30" } });
  });
}
