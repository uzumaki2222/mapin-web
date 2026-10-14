import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySlippage, slippagePercentToBps, bpsOf, priceImpactBps, marketCapWad, getAmountOutV2,
  spotPriceFromReservesWad, deadlineFromNow, WAD,
} from "../lib/market/math.ts";
import { MarketStatusCode, phaseFromStatus, progressPercent, progressWad, resolveTradeRoute, isTaxMarket, statusFromPons } from "../lib/market/state.ts";
import { GraduationPhase, PONS_MEME_HOOK, ZERO_ADDRESS } from "../lib/contracts/constants.ts";
import { poolIdOf, sortedPoolKey } from "../lib/market/v4.ts";

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
  assert.equal(statusFromPons(GraduationPhase.NotGraduated, false), MarketStatusCode.Bonding);
  assert.equal(statusFromPons(GraduationPhase.NotGraduated, true), MarketStatusCode.Graduating);
  assert.equal(statusFromPons(GraduationPhase.Swept, false), MarketStatusCode.Graduating);
  assert.equal(statusFromPons(GraduationPhase.PoolCreated, true), MarketStatusCode.Graduated);
  assert.equal(statusFromPons(GraduationPhase.Rescued, false), MarketStatusCode.Halted);
  assert.equal(phaseFromStatus(MarketStatusCode.Bonding), "bonding");
  assert.equal(phaseFromStatus(MarketStatusCode.Graduated), "graduated");
  assert.equal(phaseFromStatus(MarketStatusCode.Graduating), "staged");
  assert.equal(phaseFromStatus(MarketStatusCode.Halted), "halted");
  assert.equal(phaseFromStatus(0), "unknown");
  assert.equal(phaseFromStatus(99), "unknown");
  assert.equal(progressPercent(WAD / 2n), 50);
  assert.equal(progressPercent(WAD * 2n), 100);
  assert.equal(progressPercent(-1n), 0);
  assert.equal(progressPercent((WAD * 1234n) / 10_000n), 12.34);
  assert.equal(progressWad(21n * WAD / 10n, 42n * WAD / 10n), WAD / 2n);
  assert.equal(progressWad(5n * WAD, 42n * WAD / 10n), WAD);

  const curve = "0x2222222222222222222222222222222222222222";
  const key = sortedPoolKey("0x1111111111111111111111111111111111111111", ZERO_ADDRESS, 0, 200, PONS_MEME_HOOK);
  const poolId = poolIdOf(key);
  assert.deepEqual(resolveTradeRoute({ status: MarketStatusCode.Bonding, pool: "", curve }, null), { kind: "curve", curve });
  assert.equal(resolveTradeRoute({ status: MarketStatusCode.Graduating, pool: "", curve }, null).kind, "graduate");
  assert.deepEqual(resolveTradeRoute({ status: MarketStatusCode.Graduated, pool: poolId, curve }, { poolId, key }), { kind: "dex", pool: poolId, key });
  assert.equal(resolveTradeRoute({ status: MarketStatusCode.Graduated, pool: poolId, curve }, null).kind, "unavailable");
  assert.equal(resolveTradeRoute({ status: MarketStatusCode.Graduated, pool: "", curve }, { poolId, key }).kind, "unavailable");
  assert.equal(resolveTradeRoute({ status: MarketStatusCode.Graduated, pool: poolId, curve }, { poolId: "0x" + "1".repeat(64), key }).kind, "unavailable");
  assert.equal(resolveTradeRoute({ status: MarketStatusCode.Halted, pool: "", curve }, null).kind, "unavailable");
  assert.equal(isTaxMarket({ buyTaxRate: 0n, sellTaxRate: 1n }), true);
  assert.equal(isTaxMarket({ buyTaxRate: 0n, sellTaxRate: 0n }), false);
});
