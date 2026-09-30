// Pure market-state interpretation of the Portal lens (getTokenV8Safe).

import { TokenStatus, ZERO_ADDRESS } from "../contracts/constants.ts";
import { WAD } from "./math.ts";

export type MarketPhase = "bonding" | "graduated" | "staged" | "halted" | "unknown";

export interface LensState {
  status: number;
  reserve: bigint;
  circulatingSupply: bigint;
  price: bigint;
  tokenVersion: number;
  dexSupplyThresh: bigint;
  quoteTokenAddress: string;
  nativeToQuoteSwapEnabled: boolean;
  buyTaxRate: bigint;
  sellTaxRate: bigint;
  pool: string;
  progress: bigint;
}

export function phaseFromStatus(status: number): MarketPhase {
  switch (status) {
    case TokenStatus.Tradable:
      return "bonding";
    case TokenStatus.DEX:
      return "graduated";
    case TokenStatus.Staged:
      return "staged";
    case TokenStatus.InDuel:
    case TokenStatus.Killed:
      return "halted";
    default:
      return "unknown";
  }
}

/** Bonding progress as a percentage 0..100 with two decimals, from a 1e18-scaled wad. */
export function progressPercent(progressWad: bigint): number {
  if (progressWad <= 0n) return 0;
  if (progressWad >= WAD) return 100;
  return Number((progressWad * 10_000n) / WAD) / 100;
}

export type TradeRoute =
  | { kind: "curve" }
  | { kind: "dex"; pool: string }
  | { kind: "unavailable"; reason: string };

/**
 * Decide how a market trades.
 *  - bonding → Portal bonding curve
 *  - graduated → PancakeSwap v2 pair, only if that pair was verified on-chain (`verifiedPool`)
 */
export function resolveTradeRoute(state: Pick<LensState, "status" | "pool">, verifiedPool: string | null): TradeRoute {
  const phase = phaseFromStatus(state.status);
  if (phase === "bonding") return { kind: "curve" };
  if (phase === "graduated") {
    if (!state.pool || state.pool.toLowerCase() === ZERO_ADDRESS) {
      return { kind: "unavailable", reason: "Market graduated but no liquidity pool is registered yet." };
    }
    if (!verifiedPool || verifiedPool.toLowerCase() !== state.pool.toLowerCase()) {
      return { kind: "unavailable", reason: "The graduated liquidity pool could not be verified on-chain." };
    }
    return { kind: "dex", pool: verifiedPool };
  }
  if (phase === "staged") return { kind: "unavailable", reason: "This market is not live yet." };
  if (phase === "halted") return { kind: "unavailable", reason: "Trading is halted for this market." };
  return { kind: "unavailable", reason: "This token is not a mapin token." };
}

export function isTaxMarket(state: Pick<LensState, "buyTaxRate" | "sellTaxRate">): boolean {
  return state.buyTaxRate > 0n || state.sellTaxRate > 0n;
}
