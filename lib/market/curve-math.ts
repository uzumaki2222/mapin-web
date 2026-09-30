// Pons v2 bonding-curve pricing — pure bigint, no floating point.
// Ported 1:1 from github.com/ponsmcp/pons-mcp src/quote.ts (itself a transcription of
// PonsV2BondingCurveMath and the fee ordering of PonsV2BondingCurve.buy / .sell). Integer
// arithmetic matches the contract's truncation, so quotes equal what the curve will execute.

export const BPS = 10_000n;

/** Minimum share of a taxed buy the contract guarantees the buyer keeps, in bps. */
const MIN_BUYER_SHARE_BPS = 100n;

export class CurveMathError extends Error {
  constructor(readonly reason: "input" | "output" | "liquidity") {
    super(
      reason === "liquidity"
        ? "The bonding curve has no tokens left to sell at this size."
        : reason === "output"
          ? "Amount is too small to receive anything at the current price."
          : "Enter an amount above 0.",
    );
    this.name = "CurveMathError";
  }
}

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) throw new CurveMathError("input");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new CurveMathError("liquidity");
  const out = (amountIn * reserveOut) / (reserveIn + amountIn);
  if (out === 0n) throw new CurveMathError("output");
  return out;
}

export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n) throw new CurveMathError("output");
  if (reserveIn <= 0n || reserveOut <= amountOut) throw new CurveMathError("liquidity");
  return (amountOut * reserveIn) / (reserveOut - amountOut) + 1n;
}

function mulDivCeil(x: bigint, y: bigint, d: bigint): bigint {
  const p = x * y;
  return p % d === 0n ? p / d : p / d + 1n;
}

export interface CurveState {
  /** Tradeable quote reserve including the phantom (virtual) reserve — curve.getReserves()[0]. */
  quoteReserve: bigint;
  /** curve.getReserves()[1] */
  tokenReserve: bigint;
  /** Tokens held back to seed the graduated pool. */
  reservedTokens: bigint;
  curveFeeBps: bigint;
  creatorTaxBps: bigint;
}

export interface BuyQuote {
  offered: bigint;
  /** Actually charged (less than offered when the buy fills the curve; the rest is refunded). */
  spent: bigint;
  refund: bigint;
  tokensOut: bigint;
  curveFee: bigint;
  creatorTax: bigint;
  snipeTax: bigint;
  clamped: boolean;
}

export function boundedSnipeTaxBps(state: CurveState, snipeTaxBps: bigint): bigint {
  if (snipeTaxBps <= 0n) return 0n;
  const max = BPS - state.curveFeeBps - state.creatorTaxBps - MIN_BUYER_SHARE_BPS;
  if (max <= 0n) return 0n;
  return snipeTaxBps > max ? max : snipeTaxBps;
}

/** Price a buy of `offered` quote units; mirrors PonsV2BondingCurve.buy. */
export function quoteBuy(state: CurveState, offered: bigint, snipeTaxBps = 0n): BuyQuote {
  if (offered <= 0n) throw new CurveMathError("input");
  const sellable = state.tokenReserve > state.reservedTokens ? state.tokenReserve - state.reservedTokens : 0n;
  if (sellable === 0n) throw new CurveMathError("liquidity");

  const bounded = boundedSnipeTaxBps(state, snipeTaxBps);
  const legs = (amount: bigint) => ({
    fee: (amount * state.curveFeeBps) / BPS,
    tax: (amount * state.creatorTaxBps) / BPS,
    snipe: (amount * bounded) / BPS,
  });

  let spent = offered;
  let { fee, tax, snipe } = legs(spent);
  let tokensOut = getAmountOut(spent - fee - tax - snipe, state.quoteReserve, state.tokenReserve);

  let clamped = false;
  if (tokensOut > sellable) {
    clamped = true;
    tokensOut = sellable;
    const net = getAmountIn(sellable, state.quoteReserve, state.tokenReserve);
    const grossed = mulDivCeil(net, BPS, BPS - state.curveFeeBps - state.creatorTaxBps - bounded);
    spent = grossed < offered ? grossed : offered;
    ({ fee, tax, snipe } = legs(spent));
  }
  return { offered, spent, refund: offered - spent, tokensOut, curveFee: fee, creatorTax: tax, snipeTax: snipe, clamped };
}

export interface SellQuote {
  tokensIn: bigint;
  gross: bigint;
  quoteOut: bigint;
  curveFee: bigint;
  creatorTax: bigint;
}

/** Price a sell of `tokensIn`; mirrors PonsV2BondingCurve.sell (fees taken from the output). */
export function quoteSell(state: CurveState, tokensIn: bigint): SellQuote {
  if (tokensIn <= 0n) throw new CurveMathError("input");
  const gross = getAmountOut(tokensIn, state.tokenReserve, state.quoteReserve);
  const curveFee = (gross * state.curveFeeBps) / BPS;
  const creatorTax = (gross * state.creatorTaxBps) / BPS;
  return { tokensIn, gross, quoteOut: gross - curveFee - creatorTax, curveFee, creatorTax };
}

/**
 * Buy slippage floor. The curve enforces a price bound (`spent * minTokensOut <= received * tokensOut`),
 * so on a clamped (partial) fill the floor must be scaled by spent / offered or the buy reverts.
 */
export function buyMinTokensOut(q: BuyQuote, slippageBps: number): bigint {
  const base = q.clamped && q.offered > 0n ? (q.tokensOut * q.spent) / q.offered : q.tokensOut;
  return (base * (BPS - BigInt(slippageBps))) / BPS;
}

/**
 * Spot price of one token in the pair asset, 1e18-scaled and normalised to 18 decimals
 * (so a 6-decimal USDG pair and an 18-decimal ETH / stock pair are read the same way).
 * Launch tokens are always 18 decimals.
 */
export function curveSpotPriceWad(quoteReserve: bigint, tokenReserve: bigint, quoteDecimals = 18): bigint {
  if (tokenReserve <= 0n) return 0n;
  return (to18(quoteReserve, quoteDecimals) * 10n ** 18n) / tokenReserve;
}

/** Scale a raw amount with `decimals` to 18 decimals. */
export function to18(v: bigint, decimals: number): bigint {
  return decimals <= 18 ? v * 10n ** BigInt(18 - decimals) : v / 10n ** BigInt(decimals - 18);
}

/**
 * Opening-buy quote for a brand-new curve (used for the launch-and-buy slippage floor).
 * A fresh curve holds the whole supply with the phantom quote reserve; the reserved share is
 * supply * phantom / (phantom + threshold) (PonsV2BondingCurve.initialize).
 */
export function quoteOpeningBuy(
  config: { supply: bigint; curveFeeBps: bigint; phantomQuote: bigint; graduationThreshold: bigint },
  creatorTaxBps: bigint,
  offered: bigint,
): BuyQuote {
  const { supply, curveFeeBps, phantomQuote, graduationThreshold } = config;
  if (supply <= 0n || phantomQuote + graduationThreshold <= 0n) throw new CurveMathError("liquidity");
  const reservedTokens = (supply * phantomQuote) / (phantomQuote + graduationThreshold);
  return quoteBuy({ quoteReserve: phantomQuote, tokenReserve: supply, reservedTokens, curveFeeBps, creatorTaxBps }, offered, 0n);
}
