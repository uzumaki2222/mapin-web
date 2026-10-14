"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { QuoteAsset } from "@/lib/market/onchain";

export interface QuoteAssetsResponse {
  assets: QuoteAsset[];
  /** bonding-curve trading fee */
  fee: { buyBps: string; sellBps: string } | null;
  /** live launch terms from the launch protocol (raw integers as strings) */
  launch: { launchFee: string; graduationThreshold: string; maxCreatorTaxBps: string; supply: string; enabled: boolean } | null;
  stale?: boolean;
}

/** Supported pair assets and live launch terms (read server-side from the launch factory). */
export function useQuoteAssets() {
  return useQuery({ queryKey: ["quote-assets"], queryFn: () => api<QuoteAssetsResponse>("/api/quote-tokens"), staleTime: 60_000 });
}
