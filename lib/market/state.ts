// Pure market-state interpretation of a Pons v2 launch (factory.getLaunchedToken + curve reads).

import { GraduationPhase, ZERO_ADDRESS } from "../contracts/constants.ts";
import { WAD } from "./math.ts";
import type { PoolKey } from "./v4.ts";

export type MarketPhase = "bonding" | "graduated" | "staged" | "halted" | "unknown";

/** App-level status codes (stable numbers the UI and DB logic switch on). */
export const MarketStatusCode = { Invalid: 0, Bonding: 1, Halted: 3, Graduated: 4, Graduating: 5 } as const;

export interface LensState {
  /** MarketStatusCode */
  status: number;
  /** Raw Pons GraduationPhase (0 curve, 1 swept, 2 pool created, 3 rescued) */
  ponsPhase: number;
  curve: string;
  readyToGraduate: boolean;
  /** Real pair-asset reserve held by the curve (fees excluded); swept amount after graduation. */
  reserve: bigint;
  /** Curve reserves used for pricing (quote includes the phantom reserve). */
  quoteReserve: bigint;
  tokenReserve: bigint;
  reservedTokens: bigint;
  circulatingSupply: bigint;
  /** Pair asset per 1 token, 1e18-scaled. */
  price: bigint;
  graduationThreshold: bigint;
  quoteTokenAddress: string;
  curveFeeBps: bigint;
  /** Pons creator fee, charged on buys and sells (paid to the creator). */
  buyTaxRate: bigint;
  sellTaxRate: bigint;
  /** Uniswap v4 pool id once graduated, else "" */
  pool: string;
  poolFee: number;
  tickSpacing: number;
  /** 1e18 = 100 % of the graduation threshold raised */
  progress: bigint;
}

export function statusFromPons(phase: number, readyToGraduate: boolean): number {
  switch (phase) {
    case GraduationPhase.NotGraduated:
      return readyToGraduate ? MarketStatusCode.Graduating : MarketStatusCode.Bonding;
    case GraduationPhase.Swept:
      return MarketStatusCode.Graduating;
    case GraduationPhase.PoolCreated:
      return MarketStatusCode.Graduated;
    case GraduationPhase.Rescued:
      return MarketStatusCode.Halted;
    default:
      return MarketStatusCode.Invalid;
  }
}

export function phaseFromStatus(status: number): MarketPhase {
  switch (status) {
    case MarketStatusCode.Bonding:
      return "bonding";
    case MarketStatusCode.Graduated:
      return "graduated";
    case MarketStatusCode.Graduating:
      return "staged";
    case MarketStatusCode.Halted:
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

/** raised / threshold as a wad, capped at 100 %. */
export function progressWad(raised: bigint, threshold: bigint): bigint {
  if (threshold <= 0n) return 0n;
  const p = (raised * WAD) / threshold;
  return p > WAD ? WAD : p;
}

export type TradeRoute =
  | { kind: "curve"; curve: string }
  | { kind: "dex"; pool: string; key: PoolKey }
  | { kind: "graduate"; reason: string }
  | { kind: "unavailable"; reason: string };

/**
 * Decide how a market trades.
 *  - bonding   → the token's Pons bonding curve
 *  - staged    → the curve is full; anyone can finish graduation (factory.graduate / createGraduatedPool)
 *  - graduated → the Uniswap v4 pool, only if it was verified on-chain (`verified`)
 */
export function resolveTradeRoute(
  state: Pick<LensState, "status" | "pool" | "curve">,
  verified: { poolId: string; key: PoolKey } | null,
): TradeRoute {
  const phase = phaseFromStatus(state.status);
  if (phase === "bonding") return { kind: "curve", curve: state.curve };
  if (phase === "staged") {
    return { kind: "graduate", reason: "The bonding curve is full. Graduation to Uniswap v4 is pending — anyone can complete it." };
  }
  if (phase === "graduated") {
    if (!state.pool || state.pool === "0x" + "0".repeat(64)) {
      return { kind: "unavailable", reason: "Market graduated but no liquidity pool is registered yet." };
    }
    if (!verified || verified.poolId.toLowerCase() !== state.pool.toLowerCase()) {
      return { kind: "unavailable", reason: "The graduated liquidity pool could not be verified on-chain." };
    }
    return { kind: "dex", pool: verified.poolId, key: verified.key };
  }
  if (phase === "halted") return { kind: "unavailable", reason: "Graduation was rescued by the protocol; trading is closed for this market." };
  return { kind: "unavailable", reason: "This token is not a mapin token." };
}

export function isTaxMarket(state: Pick<LensState, "buyTaxRate" | "sellTaxRate">): boolean {
  return state.buyTaxRate > 0n || state.sellTaxRate > 0n;
}

export const isNativePair = (quote: string) => quote.toLowerCase() === ZERO_ADDRESS;
