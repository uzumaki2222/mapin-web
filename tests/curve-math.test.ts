import { test } from "node:test";
import assert from "node:assert/strict";
import { buyMinTokensOut, curveSpotPriceWad, quoteBuy, quoteOpeningBuy, quoteSell, CurveMathError, type CurveState } from "../lib/market/curve-math.ts";

const E = 10n ** 18n;
// Live Pons launch config 0 (pons-mcp docs/PROTOCOL.md): 1B supply, 1% fee, 1.68 ETH phantom, 4.2 ETH threshold.
const cfg = { supply: 1_000_000_000n * E, curveFeeBps: 100n, phantomQuote: 168n * E / 100n, graduationThreshold: 42n * E / 10n };

test("opening buy on a fresh curve", () => {
  const q = quoteOpeningBuy(cfg, 0n, E); // 1 ETH
  assert.equal(q.clamped, false);
  assert.equal(q.curveFee, E / 100n);
  // net 0.99 ETH against 1.68 ETH phantom: out = 0.99 * 1e9 / (1.68 + 0.99)
  const net = E - E / 100n;
  assert.equal(q.tokensOut, (net * cfg.supply) / (cfg.phantomQuote + net));
  assert.ok(q.tokensOut > 370_000_000n * E && q.tokensOut < 371_000_000n * E);
  assert.equal(buyMinTokensOut(q, 500), (q.tokensOut * 9_500n) / 10_000n);
});

test("creator fee reduces tokens out", () => {
  assert.ok(quoteOpeningBuy(cfg, 500n, E).tokensOut < quoteOpeningBuy(cfg, 0n, E).tokensOut);
});

test("a buy larger than the curve is clamped and partly refunded", () => {
  const q = quoteOpeningBuy(cfg, 0n, 100n * E);
  assert.equal(q.clamped, true);
  const reserved = (cfg.supply * cfg.phantomQuote) / (cfg.phantomQuote + cfg.graduationThreshold);
  assert.equal(q.tokensOut, cfg.supply - reserved);
  assert.ok(q.spent < 100n * E && q.refund > 0n);
  // price-bound floor: spent * min <= offered * tokensOut
  const min = buyMinTokensOut(q, 100);
  assert.ok(q.spent * min <= q.offered * q.tokensOut);
  assert.ok(min < q.tokensOut);
});

test("sell charges fees on the output and round-trips below the input", () => {
  const state: CurveState = { quoteReserve: cfg.phantomQuote, tokenReserve: cfg.supply, reservedTokens: 0n, curveFeeBps: 100n, creatorTaxBps: 0n };
  const b = quoteBuy(state, E);
  const after: CurveState = { ...state, quoteReserve: state.quoteReserve + b.spent - b.curveFee, tokenReserve: state.tokenReserve - b.tokensOut };
  const s = quoteSell(after, b.tokensOut);
  assert.equal(s.curveFee, s.gross / 100n);
  assert.ok(s.quoteOut < E);
  assert.throws(() => quoteSell(after, 0n), CurveMathError);
});

test("spot price", () => {
  assert.equal(curveSpotPriceWad(2n * E, 1_000n * E), 2n * 10n ** 15n);
  // 6-decimal pair (USDG): 2 USDG / 1000 tokens → 0.002, normalised to 18 decimals
  assert.equal(curveSpotPriceWad(2_000_000n, 1_000n * E, 6), 2n * 10n ** 15n);
  assert.equal(curveSpotPriceWad(1n, 0n), 0n);
});
