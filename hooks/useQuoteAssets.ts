"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { QuoteAsset } from "@/lib/market/onchain";

export interface QuoteAssetsResponse {
  assets: QuoteAsset[];
  fee: { buyBps: string; sellBps: string } | null;
  stale?: boolean;
}

/** Pair assets enabled on-chain right now (read server-side from the market contract). */
export function useQuoteAssets() {
  return useQuery({ queryKey: ["quote-assets"], queryFn: () => api<QuoteAssetsResponse>("/api/quote-tokens"), staleTime: 60_000 });
}
