"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, PublicClient } from "viem";
import { readLensState, verifyDexPool, type VerifiedPool } from "@/lib/market/onchain";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { phaseFromStatus, resolveTradeRoute, type LensState, type TradeRoute } from "@/lib/market/state";
import { BSC_CHAIN_ID } from "@/lib/contracts/constants";

export interface MarketChainState {
  lens: LensState;
  totalSupply: bigint;
  pool: VerifiedPool | null;
  route: TradeRoute;
  phase: ReturnType<typeof phaseFromStatus>;
}

/** Live market state straight from BNB Chain (never from a cache or mock). */
export function useMarketChain(token: Address) {
  const client = usePublicClient({ chainId: BSC_CHAIN_ID }) as unknown as PublicClient | undefined;
  return useQuery({
    queryKey: ["market-chain", token],
    enabled: Boolean(client),
    refetchInterval: 12_000,
    queryFn: async (): Promise<MarketChainState> => {
      const pc = client!;
      const [lens, totalSupply] = await Promise.all([
        readLensState(pc, token),
        pc.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
      ]);
      const phase = phaseFromStatus(lens.status);
      const pool = phase === "graduated" ? await verifyDexPool(pc, token, lens) : null;
      return { lens, totalSupply, pool, route: resolveTradeRoute(lens, pool?.pool ?? null), phase };
    },
  });
}
