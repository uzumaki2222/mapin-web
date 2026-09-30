import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySlippage, slippagePercentToBps, bpsOf, priceImpactBps, marketCapWad, getAmountOutV2,
  spotPriceFromReservesWad, deadlineFromNow, WAD,
} from "../lib/market/math.ts";
import { phaseFromStatus, progressPercent, resolveTradeRoute, isTaxMarket } from "../lib/market/state.ts";
import { TokenStatus } from "../lib/contracts/constants.ts";

test("slippage", () => {
  assert.equal(applySlippage(10_000n, 100), 9_900n);
  assert.equal(applySlippage(1n, 100), 0n); // rounds down
  assert.equal(applySlippage(123_456_789n, 50), 122_839_505n);
  assert.throws(() => applySlippage(1n, 0));
  assert.throws(() => applySlippage(1n, 5001));
  assert.throws(() => applySlippage(1n, 1.5));
  assert.equal(slippagePercentToBps("0.5"), 50);
  assert.equal(slippagePercentToBps("3"), 300);
  assert.equal(slippagePercentToBps("0.05"), 5);
  assert.throws(() => slippagePercentToBps("abc"));
  assert.throws(() => slippagePercentToBps("60"));
  assert.equal(bpsOf(1_000n, 250), 25n);
});

test("price impact", () => {
  // spot 1 quote/token, pay 10 get 10 => 0 impact
  assert.equal(priceImpactBps({ side: "buy", spotPriceWad: WAD, amountIn: 10n * WAD, amountOut: 10n * WAD, quoteDecimals: 18, tokenDecimals: 18 }), 0);
  // pay 11 for 10 => 10%
  assert.equal(priceImpactBps({ side: "buy", spotPriceWad: WAD, amountIn: 11n * WAD, amountOut: 10n * WAD, quoteDecimals: 18, tokenDecimals: 18 }), 1000);
  // sell 10 get 9 => 10%
  assert.equal(priceImpactBps({ side: "sell", spotPriceWad: WAD, amountIn: 10n * WAD, amountOut: 9n * WAD, quoteDecimals: 18, tokenDecimals: 18 }), 1000);
  // 6-decimal quote normalised
  assert.equal(priceImpactBps({ side: "buy", spotPriceWad: WAD, amountIn: 11_000_000n, amountOut: 10n * WAD, quoteDecimals: 6, tokenDecimals: 18 }), 1000);
  assert.equal(priceImpactBps({ side: "buy", spotPriceWad: 0n, amountIn: 1n, amountOut: 1n, quoteDecimals: 18, tokenDecimals: 18 }), null);
});

test("market cap and v2 math", () => {
  // price 0.000001 quote, supply 1e9 tokens => 1000 quote
  assert.equal(marketCapWad(10n ** 12n, 10n ** 9n * WAD), 1000n * WAD);
  // classic v2 example with 0.25% fee
  assert.equal(getAmountOutV2(1_000n, 100_000n, 100_000n), 987n);
  assert.equal(getAmountOutV2(0n, 1n, 1n), 0n);
  assert.equal(spotPriceFromReservesWad(1_000n * WAD, 2n * WAD, 18, 18), 2n * 10n ** 15n);
  assert.equal(deadlineFromNow(60, 1_000_000), 1_060n);
});

test("market state", () => {
  assert.equal(phaseFromStatus(TokenStatus.Tradable), "bonding");
  assert.equal(phaseFromStatus(TokenStatus.DEX), "graduated");
  assert.equal(phaseFromStatus(TokenStatus.Staged), "staged");
  assert.equal(phaseFromStatus(TokenStatus.Killed), "halted");
  assert.equal(phaseFromStatus(0), "unknown");
  assert.equal(phaseFromStatus(99), "unknown");
  assert.equal(progressPercent(WAD / 2n), 50);
  assert.equal(progressPercent(WAD * 2n), 100);
  assert.equal(progressPercent(-1n), 0);
  assert.equal(progressPercent((WAD * 1234n) / 10_000n), 12.34);

  const pool = "0x1111111111111111111111111111111111111111";
  assert.deepEqual(resolveTradeRoute({ status: TokenStatus.Tradable, pool: "0x0000000000000000000000000000000000000000" }, null), { kind: "curve" });
  assert.deepEqual(resolveTradeRoute({ status: TokenStatus.DEX, pool }, pool), { kind: "dex", pool });
  assert.equal(resolveTradeRoute({ status: TokenStatus.DEX, pool }, null).kind, "unavailable");
  assert.equal(resolveTradeRoute({ status: TokenStatus.DEX, pool: "0x0000000000000000000000000000000000000000" }, pool).kind, "unavailable");
  assert.equal(resolveTradeRoute({ status: TokenStatus.DEX, pool }, "0x2222222222222222222222222222222222222222").kind, "unavailable");
  assert.equal(isTaxMarket({ buyTaxRate: 0n, sellTaxRate: 1n }), true);
  assert.equal(isTaxMarket({ buyTaxRate: 0n, sellTaxRate: 0n }), false);
});
