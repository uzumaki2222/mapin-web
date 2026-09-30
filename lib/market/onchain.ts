import {
  getAddress,
  type Address,
  type PublicClient,
} from "viem";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { pancakeV2FactoryAbi, pancakeV2PairAbi, pancakeV2RouterAbi } from "@/lib/contracts/pancake-abi";
import {
  PANCAKE_V2_FACTORY,
  PANCAKE_V2_ROUTER,
  PORTAL_ADDRESS,
  QUOTE_TOKEN_CANDIDATES,
  ZERO_ADDRESS,
} from "@/lib/contracts/constants";
import type { LensState } from "@/lib/market/state";
import { BPS_DENOMINATOR } from "@/lib/market/math";

// Isomorphic on-chain reads. Callers pass a viem PublicClient (server client or wagmi's).

const isZero = (a: string) => a.toLowerCase() === ZERO_ADDRESS;

/** Portal lens: getTokenV8Safe (forward compatible), falling back to getTokenV6 on deployments without it. */
export async function readLensState(client: PublicClient, token: Address): Promise<LensState> {
  try {
    const s = await client.readContract({
      address: PORTAL_ADDRESS,
      abi: portalAbi,
      functionName: "getTokenV8Safe",
      args: [token],
    });
    return {
      status: Number(s.status),
      reserve: s.reserve,
      circulatingSupply: s.circulatingSupply,
      price: s.price,
      tokenVersion: Number(s.tokenVersion),
      dexSupplyThresh: s.dexSupplyThresh,
      quoteTokenAddress: s.quoteTokenAddress,
      nativeToQuoteSwapEnabled: s.nativeToQuoteSwapEnabled,
      buyTaxRate: s.buyTaxRate,
      sellTaxRate: s.sellTaxRate,
      pool: s.pool,
      progress: s.progress,
    };
  } catch (v8Error) {
    try {
      const s = await client.readContract({
        address: PORTAL_ADDRESS,
        abi: portalAbi,
        functionName: "getTokenV6",
        args: [token],
      });
      return {
        status: Number(s.status),
        reserve: s.reserve,
        circulatingSupply: s.circulatingSupply,
        price: s.price,
        tokenVersion: Number(s.tokenVersion),
        dexSupplyThresh: s.dexSupplyThresh,
        quoteTokenAddress: s.quoteTokenAddress,
        nativeToQuoteSwapEnabled: s.nativeToQuoteSwapEnabled,
        buyTaxRate: s.taxRate,
        sellTaxRate: s.taxRate,
        pool: s.pool,
        progress: s.progress,
      };
    } catch {
      throw v8Error;
    }
  }
}

export interface TokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export async function readTokenInfo(client: PublicClient, token: Address): Promise<TokenInfo> {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  return { address: token, name, symbol, decimals: Number(decimals), totalSupply };
}

export interface QuoteAsset {
  address: Address; // ZERO_ADDRESS for native BNB
  symbol: string;
  decimals: number;
  isNative: boolean;
}

export const NATIVE_QUOTE: QuoteAsset = { address: ZERO_ADDRESS, symbol: "BNB", decimals: 18, isNative: true };

/** ERC-20 metadata for a quote asset — decimals are always read from the token contract. */
export async function readQuoteAsset(client: PublicClient, address: Address): Promise<QuoteAsset> {
  if (isZero(address)) return NATIVE_QUOTE;
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address: getAddress(address), symbol, decimals: Number(decimals), isNative: false };
}

/**
 * Pair assets currently accepted by the Portal: native BNB plus every candidate ERC-20 whose
 * on-chain QuoteTokenConfiguration.enabled == 1. Anything disabled or unreadable is omitted.
 */
export async function readEnabledQuoteAssets(client: PublicClient): Promise<QuoteAsset[]> {
  const configs = await Promise.allSettled(
    QUOTE_TOKEN_CANDIDATES.map((address) =>
      client.readContract({
        address: PORTAL_ADDRESS,
        abi: portalAbi,
        functionName: "getQuoteTokenConfiguration",
        args: [address],
      }),
    ),
  );
  const enabled = QUOTE_TOKEN_CANDIDATES.filter((_, i) => {
    const r = configs[i];
    return r?.status === "fulfilled" && Number(r.value.enabled) === 1;
  });
  const assets = await Promise.allSettled(enabled.map((a) => readQuoteAsset(client, a)));
  return [NATIVE_QUOTE, ...assets.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
}

export async function readProtocolFeeRate(client: PublicClient): Promise<{ buyBps: bigint; sellBps: bigint } | null> {
  try {
    const [buy, sell] = await client.readContract({ address: PORTAL_ADDRESS, abi: portalAbi, functionName: "getFeeRate" });
    return { buyBps: buy, sellBps: sell };
  } catch {
    return null;
  }
}

export interface VerifiedPool {
  pool: Address;
  pairQuote: Address; // WBNB for native markets
  wrappedNative: Address;
  reserveToken: bigint;
  reserveQuote: bigint;
}

/**
 * Verify on-chain that the pool the Portal reports for a graduated token is a live
 * PancakeSwap v2 pair: bytecode exists, the v2 factory maps (token, quote) to it,
 * its token0/token1 match, and both reserves are non-zero.
 */
export async function verifyDexPool(client: PublicClient, token: Address, lens: LensState): Promise<VerifiedPool | null> {
  if (!lens.pool || isZero(lens.pool)) return null;
  const pool = getAddress(lens.pool);
  const code = await client.getCode({ address: pool });
  if (!code || code === "0x") return null;
  const wrappedNative = await client.readContract({ address: PANCAKE_V2_ROUTER, abi: pancakeV2RouterAbi, functionName: "WETH" });
  const pairQuote = isZero(lens.quoteTokenAddress) ? wrappedNative : getAddress(lens.quoteTokenAddress);
  const pair = await client.readContract({
    address: PANCAKE_V2_FACTORY,
    abi: pancakeV2FactoryAbi,
    functionName: "getPair",
    args: [token, pairQuote],
  });
  if (pair.toLowerCase() !== pool.toLowerCase()) return null;
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address: pool, abi: pancakeV2PairAbi, functionName: "token0" }),
    client.readContract({ address: pool, abi: pancakeV2PairAbi, functionName: "token1" }),
    client.readContract({ address: pool, abi: pancakeV2PairAbi, functionName: "getReserves" }),
  ]);
  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const tk = token.toLowerCase();
  const q = pairQuote.toLowerCase();
  if (!((t0 === tk && t1 === q) || (t0 === q && t1 === tk))) return null;
  const [r0, r1] = reserves;
  const reserveToken = t0 === tk ? r0 : r1;
  const reserveQuote = t0 === tk ? r1 : r0;
  if (reserveToken === 0n || reserveQuote === 0n) return null;
  return { pool, pairQuote, wrappedNative, reserveToken, reserveQuote };
}

// ------------------------------------------------------------------ quoting

export type TradeSide = "buy" | "sell";

/** Bonding-curve quote from the Portal (quoteExactInput is non-view; evaluated with eth_call). */
export async function quoteCurve(client: PublicClient, params: { inputToken: Address; outputToken: Address; inputAmount: bigint }): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: PORTAL_ADDRESS,
    abi: portalAbi,
    functionName: "quoteExactInput",
    args: [params],
  });
  return result;
}

/**
 * PancakeSwap v2 quote. getAmountsOut ignores transfer taxes, so the token's buy/sell tax
 * (from the Portal lens) is applied on top to keep minimum-received honest.
 */
export async function quoteDex(
  client: PublicClient,
  args: { side: TradeSide; token: Address; pairQuote: Address; amountIn: bigint; buyTaxBps: bigint; sellTaxBps: bigint },
): Promise<bigint> {
  const { side, token, pairQuote, amountIn, buyTaxBps, sellTaxBps } = args;
  if (side === "buy") {
    const amounts = await client.readContract({
      address: PANCAKE_V2_ROUTER, abi: pancakeV2RouterAbi, functionName: "getAmountsOut", args: [amountIn, [pairQuote, token]],
    });
    const out = amounts[amounts.length - 1] ?? 0n;
    return (out * (BPS_DENOMINATOR - buyTaxBps)) / BPS_DENOMINATOR;
  }
  const effectiveIn = (amountIn * (BPS_DENOMINATOR - sellTaxBps)) / BPS_DENOMINATOR;
  if (effectiveIn === 0n) return 0n;
  const amounts = await client.readContract({
    address: PANCAKE_V2_ROUTER, abi: pancakeV2RouterAbi, functionName: "getAmountsOut", args: [effectiveIn, [token, pairQuote]],
  });
  return amounts[amounts.length - 1] ?? 0n;
}

export async function hasBytecode(client: PublicClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return Boolean(code && code !== "0x");
}
