import { getAddress, type Address, type PublicClient } from "viem";
import { ponsCurveAbi, ponsCurveSnipeAbi, ponsFactoryAbi, ponsTokenAbi, v4QuoterAbi, v4StateViewAbi } from "@/lib/contracts/pons-abi";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import {
  GraduationPhase,
  NATIVE_SYMBOL,
  PONS_FACTORY,
  PONS_LAUNCH_CONFIG_ID,
  PONS_MEME_HOOK,
  V4_QUOTER,
  V4_STATE_VIEW,
  ZERO_ADDRESS,
} from "@/lib/contracts/constants";
import { MarketStatusCode, progressWad, statusFromPons, type LensState } from "@/lib/market/state";
import { curveSpotPriceWad, type CurveState } from "@/lib/market/curve-math";
import { poolIdOf, sortedPoolKey, v4PriceWad, type PoolKey } from "@/lib/market/v4";
import { WAD } from "@/lib/market/math";

// Isomorphic on-chain reads. Callers pass a viem PublicClient (server client or wagmi's).

const isZero = (a: string) => a.toLowerCase() === ZERO_ADDRESS;

export interface LaunchedToken {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: number;
  sweptQuote: bigint;
  sweptTokens: bigint;
  sweptAt: bigint;
  exists: boolean;
}

export async function readLaunchedToken(client: PublicClient, token: Address): Promise<LaunchedToken> {
  const r = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "getLaunchedToken", args: [token] });
  return {
    token: r.token,
    curve: r.curve,
    deployer: r.deployer,
    creatorFeeRecipient: r.creatorFeeRecipient,
    pairToken: r.pairToken,
    graduationThreshold: r.graduationThreshold,
    poolFee: Number(r.poolFee),
    tickSpacing: Number(r.tickSpacing),
    creatorTaxBps: Number(r.creatorTaxBps),
    buybackEnabled: r.buybackEnabled,
    phase: Number(r.phase),
    sweptQuote: r.sweptQuote,
    sweptTokens: r.sweptTokens,
    sweptAt: r.sweptAt,
    exists: r.exists,
  };
}

/** Pool key of a graduated launch. The hook is read live and must equal the pinned Pons hook. */
export async function graduatedPoolKey(client: PublicClient, lt: LaunchedToken): Promise<{ key: PoolKey; poolId: `0x${string}` } | null> {
  const hook = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "memeHook" });
  if (hook.toLowerCase() !== PONS_MEME_HOOK.toLowerCase()) return null; // never route funds to an unverified pool
  const key = sortedPoolKey(getAddress(lt.token), getAddress(lt.pairToken), lt.poolFee, lt.tickSpacing, getAddress(hook));
  return { key, poolId: poolIdOf(key) };
}

async function readSlot0(client: PublicClient, poolId: `0x${string}`) {
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: V4_STATE_VIEW, abi: v4StateViewAbi, functionName: "getSlot0", args: [poolId] }),
    client.readContract({ address: V4_STATE_VIEW, abi: v4StateViewAbi, functionName: "getLiquidity", args: [poolId] }),
  ]);
  return { sqrtPriceX96: slot0[0], liquidity };
}

/** Full market state for a Pons launch: curve reserves while bonding, the v4 pool after graduation. */
export async function readLensState(client: PublicClient, token: Address): Promise<LensState> {
  const lt = await readLaunchedToken(client, token);
  if (!lt.exists) {
    throw new Error("This token was not launched through the market contract.");
  }
  const [totalSupply, quote] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
    readQuoteAsset(client, lt.pairToken),
  ]);
  const qd = quote.decimals;
  const base = {
    ponsPhase: lt.phase,
    curve: lt.curve,
    graduationThreshold: lt.graduationThreshold,
    quoteTokenAddress: lt.pairToken,
    buyTaxRate: BigInt(lt.creatorTaxBps),
    sellTaxRate: BigInt(lt.creatorTaxBps),
    poolFee: lt.poolFee,
    tickSpacing: lt.tickSpacing,
  };

  if (lt.phase === GraduationPhase.PoolCreated) {
    const pk = await graduatedPoolKey(client, lt);
    let price = 0n;
    if (pk) {
      const s = await readSlot0(client, pk.poolId);
      price = v4PriceWad(s.sqrtPriceX96, pk.key.currency0.toLowerCase() === token.toLowerCase(), qd);
    }
    return {
      ...base,
      status: MarketStatusCode.Graduated,
      readyToGraduate: true,
      reserve: lt.sweptQuote,
      quoteReserve: 0n,
      tokenReserve: 0n,
      reservedTokens: 0n,
      circulatingSupply: totalSupply,
      price,
      curveFeeBps: 0n,
      pool: pk?.poolId ?? "",
      progress: WAD,
    };
  }

  const curve = lt.curve;
  const [reserves, real, reserved, ready, feeBps] = await Promise.all([
    client.readContract({ address: curve, abi: ponsCurveAbi, functionName: "getReserves" }),
    client.readContract({ address: curve, abi: ponsCurveAbi, functionName: "realQuoteReserve" }),
    client.readContract({ address: curve, abi: ponsCurveAbi, functionName: "reservedTokens" }),
    client.readContract({ address: curve, abi: ponsCurveAbi, functionName: "readyToGraduate" }),
    client.readContract({ address: curve, abi: ponsCurveAbi, functionName: "feeBps" }),
  ]);
  const [quoteReserve, tokenReserve] = reserves;
  const swept = lt.phase === GraduationPhase.Swept;
  const raised = swept ? lt.sweptQuote : real;
  return {
    ...base,
    status: statusFromPons(lt.phase, ready),
    readyToGraduate: ready,
    reserve: raised,
    quoteReserve,
    tokenReserve,
    reservedTokens: reserved,
    circulatingSupply: totalSupply > tokenReserve ? totalSupply - tokenReserve : 0n,
    price: swept && lt.sweptTokens > 0n ? curveSpotPriceWad(lt.sweptQuote, lt.sweptTokens, qd) : curveSpotPriceWad(quoteReserve, tokenReserve, qd),
    curveFeeBps: feeBps,
    pool: "",
    progress: swept ? WAD : progressWad(raised, lt.graduationThreshold),
  };
}

export function curveStateOf(lens: LensState): CurveState {
  return {
    quoteReserve: lens.quoteReserve,
    tokenReserve: lens.tokenReserve,
    reservedTokens: lens.reservedTokens,
    curveFeeBps: lens.curveFeeBps,
    creatorTaxBps: lens.buyTaxRate,
  };
}

/** Snipe tax for `who` right now (only non-zero in the first seconds after launch). */
export async function readSnipeTaxBps(client: PublicClient, curve: Address, who: Address | undefined): Promise<bigint> {
  if (!who) return 0n;
  try {
    return await client.readContract({ address: curve, abi: ponsCurveSnipeAbi, functionName: "currentSnipeTaxBps", args: [who] });
  } catch {
    return 0n;
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

export interface TokenOnchainMeta {
  logo: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
}

/** Metadata the Pons launcher token stores on-chain (logo URL, description, socials). */
export async function readTokenMeta(client: PublicClient, token: Address): Promise<TokenOnchainMeta> {
  const [logo, description, socials] = await Promise.all([
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "logo" }),
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "description" }),
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "socials" }),
  ]);
  const [twitter, telegram, , website] = socials;
  return { logo, description, website, twitter, telegram };
}

export interface QuoteAsset {
  address: Address; // ZERO_ADDRESS for native ETH
  symbol: string;
  decimals: number;
  isNative: boolean;
  /** Display name for ERC-20 pair assets (e.g. "Tesla" for the TSLA Robinhood stock token) */
  name?: string;
  /** Raw graduation threshold in this asset's units (ERC-20 pairs; ETH uses the launch config) */
  graduationThreshold?: string;
  phantomQuote?: string;
}

export const NATIVE_QUOTE: QuoteAsset = { address: ZERO_ADDRESS, symbol: NATIVE_SYMBOL, decimals: 18, isNative: true };

/** ERC-20 metadata for a quote asset — decimals are always read from the token contract. */
export async function readQuoteAsset(client: PublicClient, address: Address): Promise<QuoteAsset> {
  if (isZero(address)) return NATIVE_QUOTE;
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address: getAddress(address), symbol, decimals: Number(decimals), isNative: false };
}


export interface LaunchTerms {
  launchFee: bigint;
  launchEnabled: boolean;
  maxCreatorTaxBps: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  configEnabled: boolean;
  expectedEconomics: `0x${string}`;
  launchForwarder: Address;
  pairToken: Address;
  pairApproved: boolean;
}

/**
 * Live launch terms from the Pons factory for a pair asset: fee, caps, config 0, and the economics
 * digest to pin. ERC-20 pairs (stock tokens, USDG) carry their own phantom reserve and graduation
 * threshold in their own decimals (pairTokenEconomics).
 */
export async function readLaunchTerms(client: PublicClient, pairToken: Address = ZERO_ADDRESS): Promise<LaunchTerms> {
  const native = isZero(pairToken);
  const [launchFee, launchEnabled, maxCreatorTaxBps, cfg, expectedEconomics, launchForwarder, pairEcon, pairApproved] = await Promise.all([
    client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "launchFee" }),
    client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "launchEnabled" }),
    client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "maxCreatorTaxBps" }),
    client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "getLaunchConfig", args: [PONS_LAUNCH_CONFIG_ID] }),
    client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "previewLaunchEconomics", args: [PONS_LAUNCH_CONFIG_ID, pairToken] }),
    client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "launchForwarder" }),
    native ? Promise.resolve(null) : client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "pairTokenEconomics", args: [pairToken] }),
    native ? Promise.resolve(true) : client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "approvedPairTokens", args: [pairToken] }),
  ]);
  return {
    launchFee,
    launchEnabled,
    maxCreatorTaxBps,
    supply: cfg.supply,
    curveFeeBps: cfg.curveFeeBps,
    phantomQuote: pairEcon ? pairEcon[0] : cfg.phantomQuote,
    graduationThreshold: pairEcon ? pairEcon[1] : cfg.graduationThreshold,
    configEnabled: cfg.enabled,
    expectedEconomics,
    launchForwarder,
    pairToken,
    pairApproved,
  };
}

export interface VerifiedPool {
  poolId: `0x${string}`;
  key: PoolKey;
  sqrtPriceX96: bigint;
  liquidity: bigint;
}

/**
 * Verify on-chain that a graduated market's Uniswap v4 pool exists with the expected key
 * (token/ETH, the launch's fee + tick spacing, the pinned Pons hook) and holds liquidity.
 */
export async function verifyDexPool(client: PublicClient, token: Address): Promise<VerifiedPool | null> {
  const lt = await readLaunchedToken(client, token);
  if (!lt.exists || lt.phase !== GraduationPhase.PoolCreated) return null;
  const pk = await graduatedPoolKey(client, lt);
  if (!pk) return null;
  const s = await readSlot0(client, pk.poolId);
  if (s.sqrtPriceX96 === 0n || s.liquidity === 0n) return null;
  return { poolId: pk.poolId, key: pk.key, sqrtPriceX96: s.sqrtPriceX96, liquidity: s.liquidity };
}

// ------------------------------------------------------------------ quoting

export type TradeSide = "buy" | "sell";

/** Uniswap v4 exact-input quote from the V4Quoter (hook fees included). */
export async function quoteDex(client: PublicClient, args: { key: PoolKey; currencyIn: Address; amountIn: bigint }): Promise<bigint> {
  const zeroForOne = args.currencyIn.toLowerCase() === args.key.currency0.toLowerCase();
  const { result } = await client.simulateContract({
    address: V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: args.key, zeroForOne, exactAmount: args.amountIn, hookData: "0x" }],
  });
  return result[0];
}

export async function hasBytecode(client: PublicClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return Boolean(code && code !== "0x");
}
