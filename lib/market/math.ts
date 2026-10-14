// Pure bigint market math. No floating point for anything that reaches a transaction.

export const BPS_DENOMINATOR = 10_000n;
export const WAD = 10n ** 18n;

export const MIN_SLIPPAGE_BPS = 1;
export const MAX_SLIPPAGE_BPS = 5_000; // 50 % — hard ceiling, UI warns far below this
export const DEFAULT_SLIPPAGE_BPS = 100; // 1 %

export function assertSlippageBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < MIN_SLIPPAGE_BPS || bps > MAX_SLIPPAGE_BPS) {
    throw new RangeError(`Slippage must be between ${MIN_SLIPPAGE_BPS / 100}% and ${MAX_SLIPPAGE_BPS / 100}%`);
  }
}

/** Parse a user-entered slippage percentage ("0.5", "1", "3") to basis points. */
export function slippagePercentToBps(input: string): number {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new RangeError("Enter slippage as a percentage, e.g. 1 or 0.5");
  const [w, f = ""] = s.split(".");
  const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
  assertSlippageBps(bps);
  return bps;
}

/** Minimum acceptable output after slippage (rounds down, never above the quote). */
export function applySlippage(quotedOut: bigint, slippageBps: number): bigint {
  assertSlippageBps(slippageBps);
  if (quotedOut < 0n) throw new RangeError("Quote cannot be negative");
  return (quotedOut * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}

/** amount * bps / 10_000, rounded down. */
export function bpsOf(amount: bigint, bps: bigint | number): bigint {
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/**
 * Price impact in basis points, comparing the execution price of a trade with the spot price.
 * All inputs are raw integers:
 *   spotPriceWad  quote per 1 token, 1e18 scaled (curve reserves or the v4 pool price)
 *   side "buy":   amountIn = quote spent, amountOut = tokens received
 *   side "sell":  amountIn = tokens sold, amountOut = quote received
 * Quote and token amounts are normalised to 18 decimals first.
 * Returns a non-negative number of bps (worse-than-spot), or null when not computable.
 */
export function priceImpactBps(args: {
  side: "buy" | "sell";
  spotPriceWad: bigint;
  amountIn: bigint;
  amountOut: bigint;
  quoteDecimals: number;
  tokenDecimals: number;
}): number | null {
  const { side, spotPriceWad, amountIn, amountOut, quoteDecimals, tokenDecimals } = args;
  if (spotPriceWad <= 0n || amountIn <= 0n || amountOut <= 0n) return null;
  const to18 = (v: bigint, d: number) => (d <= 18 ? v * 10n ** BigInt(18 - d) : v / 10n ** BigInt(d - 18));
  const quote = side === "buy" ? to18(amountIn, quoteDecimals) : to18(amountOut, quoteDecimals);
  const tokens = side === "buy" ? to18(amountOut, tokenDecimals) : to18(amountIn, tokenDecimals);
  if (tokens === 0n) return null;
  const execPriceWad = (quote * WAD) / tokens;
  // buy: paid more than spot is bad; sell: received less than spot is bad
  const diff = side === "buy" ? execPriceWad - spotPriceWad : spotPriceWad - execPriceWad;
  if (diff <= 0n) return 0;
  const bps = (diff * BPS_DENOMINATOR) / spotPriceWad;
  return bps > 1_000_000n ? 1_000_000 : Number(bps);
}

/** Market cap in quote units (18-decimal fixed point): price (1e18) × totalSupply (token decimals). */
export function marketCapWad(priceWad: bigint, totalSupply: bigint, tokenDecimals = 18): bigint {
  return (priceWad * totalSupply) / 10n ** BigInt(tokenDecimals);
}

/** Uniswap-v2 style constant product output for an exact input with the pool fee in bps. */
export function getAmountOutV2(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 25n): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * (BPS_DENOMINATOR - feeBps);
  return (inWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + inWithFee);
}

/** Spot price of `token` in quote from v2 reserves, 1e18 scaled. */
export function spotPriceFromReservesWad(reserveToken: bigint, reserveQuote: bigint, tokenDecimals: number, quoteDecimals: number): bigint {
  if (reserveToken === 0n) return 0n;
  return (reserveQuote * 10n ** BigInt(tokenDecimals) * WAD) / (reserveToken * 10n ** BigInt(quoteDecimals));
}

/** Transaction deadline (unix seconds) for DEX swaps. */
export function deadlineFromNow(seconds = 20 * 60, nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000) + seconds);
}
