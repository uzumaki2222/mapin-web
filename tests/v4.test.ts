import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, keccak256, type Address } from "viem";
import { buildV4ExactInSwap, poolIdOf, sortedPoolKey, v4PriceWad } from "../lib/market/v4.ts";
import { universalRouterAbi } from "../lib/contracts/pons-abi.ts";
import { PONS_MEME_HOOK, UNIVERSAL_ROUTER, ZERO_ADDRESS } from "../lib/contracts/constants.ts";

const token = "0x1111111111111111111111111111111111111111" as Address;

test("pool key sorts native ETH first and hashes abi.encode(PoolKey)", () => {
  const key = sortedPoolKey(token, ZERO_ADDRESS, 0, 200, PONS_MEME_HOOK);
  assert.equal(key.currency0, ZERO_ADDRESS);
  assert.equal(key.currency1, token);
  const expected = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [ZERO_ADDRESS, token, 0, 200, PONS_MEME_HOOK],
  ));
  assert.equal(poolIdOf(key), expected);
});

test("price from sqrtPriceX96", () => {
  const Q96 = 1n << 96n;
  // 1 token1 per token0 => price 1 either way
  assert.equal(v4PriceWad(Q96, false), 10n ** 18n);
  // 4 tokens per ETH (sqrt = 2) => token priced at 0.25 ETH
  assert.equal(v4PriceWad(2n * Q96, false), 25n * 10n ** 16n);
  // token as currency0 against a 6-decimal quote: 1 raw token = 1e-12 quote units per raw → 1 USDG per token
  const p6 = v4PriceWad(Q96 / 1_000_000n, true, 6);
  const diff = p6 > 10n ** 18n ? p6 - 10n ** 18n : 10n ** 18n - p6;
  assert.ok(diff * 10n ** 9n < 10n ** 18n, `≈1 USDG, got ${p6}`); // within 1e-9 (integer sqrt rounding)
});

test("buy (ETH in) and sell (token in) router calls", () => {
  const key = sortedPoolKey(token, ZERO_ADDRESS, 0, 200, PONS_MEME_HOOK);
  const buy = buildV4ExactInSwap({ router: UNIVERSAL_ROUTER, key, currencyIn: ZERO_ADDRESS, amountIn: 10n ** 16n, minAmountOut: 5n, deadline: 99n });
  assert.equal(buy.value, 10n ** 16n);
  assert.equal(buy.data.slice(0, 10), "0x3593564c");
  const d = decodeFunctionData({ abi: universalRouterAbi, data: buy.data });
  assert.equal(d.args[0], "0x10"); // V4_SWAP
  assert.equal(d.args[2], 99n);
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], d.args[1][0]!);
  assert.equal(actions, "0x060b0e"); // SWAP_EXACT_IN_SINGLE, SETTLE, TAKE
  assert.equal(params.length, 3);
  const [swap] = decodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "poolKey", type: "tuple", components: [{ name: "c0", type: "address" }, { name: "c1", type: "address" }, { name: "fee", type: "uint24" }, { name: "ts", type: "int24" }, { name: "hooks", type: "address" }] },
      { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "min", type: "uint128" }, { name: "hookData", type: "bytes" }] }],
    params[0]!,
  );
  assert.equal(swap.zeroForOne, true);
  assert.equal(swap.amountIn, 10n ** 16n);
  assert.equal(swap.min, 5n);

  const sell = buildV4ExactInSwap({ router: UNIVERSAL_ROUTER, key, currencyIn: token, amountIn: 7n, minAmountOut: 1n, deadline: 99n });
  assert.equal(sell.value, 0n);
  const s = decodeFunctionData({ abi: universalRouterAbi, data: sell.data });
  const [sActions] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], s.args[1][0]!);
  assert.equal(sActions, "0x060c0e"); // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE
});
