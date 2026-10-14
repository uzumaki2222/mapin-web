// Uniswap v4 helpers for graduated Pons markets: pool key / id, spot price, and Universal Router
// V4_SWAP calldata. Encoding follows v4-periphery Actions + UniversalRouter Commands, as used
// on Robinhood Chain by github.com/ponsmcp/pons-mcp (src/v4.ts), which was exercised live there.

import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { universalRouterAbi } from "../contracts/pons-abi.ts";
import { ZERO_ADDRESS } from "../contracts/constants.ts";

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const poolKeyTuple = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

export function sortedPoolKey(tokenA: Address, tokenB: Address, fee: number, tickSpacing: number, hooks: Address): PoolKey {
  const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  return { currency0, currency1, fee, tickSpacing, hooks };
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

const Q192 = 1n << 192n;
const WAD = 10n ** 18n;

/**
 * Price of `token` in the pair asset (1e18-scaled, pair asset normalised to 18 decimals) from sqrtPriceX96.
 * sqrtPriceX96^2 / 2^192 = currency1 per currency0 in raw units. Launch tokens are 18 decimals.
 */
export function v4PriceWad(sqrtPriceX96: bigint, tokenIsCurrency0: boolean, quoteDecimals = 18): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const sq = sqrtPriceX96 * sqrtPriceX96;
  // quote units per token unit, normalised to 18 decimals; scale before dividing to keep precision
  const up = quoteDecimals <= 18 ? 10n ** BigInt(18 - quoteDecimals) : 1n;
  const down = quoteDecimals > 18 ? 10n ** BigInt(quoteDecimals - 18) : 1n;
  return tokenIsCurrency0 ? (sq * WAD * up) / (Q192 * down) : (Q192 * WAD * up) / (sq * down);
}

// UniversalRouter command bytes and v4-periphery action opcodes (stock V4 path).
export const CMD_V4_SWAP = 0x10;
export const ACT_SWAP_EXACT_IN_SINGLE = 0x06;
export const ACT_SETTLE = 0x0b;
export const ACT_SETTLE_ALL = 0x0c;
export const ACT_TAKE = 0x0e;
/** Router-side alias for "the caller" (ActionConstants.MSG_SENDER). */
export const MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
/** SETTLE/TAKE amount meaning "the whole open delta" (ActionConstants.OPEN_DELTA). */
export const OPEN_DELTA = 0n;

const UINT128_MAX = (1n << 128n) - 1n;

function exactInSingle(key: PoolKey, zeroForOne: boolean, amountIn: bigint, amountOutMinimum: bigint): Hex {
  if (amountIn <= 0n || amountIn > UINT128_MAX) throw new RangeError("Amount does not fit a uint128");
  if (amountOutMinimum < 0n || amountOutMinimum > UINT128_MAX) throw new RangeError("Minimum out does not fit a uint128");
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "poolKey", ...poolKeyTuple },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum, hookData: "0x" }],
  );
}

function v4SwapInput(actions: number[], params: Hex[]): Hex {
  const actionsHex = ("0x" + actions.map((a) => a.toString(16).padStart(2, "0")).join("")) as Hex;
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actionsHex, params]);
}

export interface SwapCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/**
 * Exact-input single-pool swap through the Universal Router.
 *  - native ETH in (buy on an ETH pool): SWAP → SETTLE(ETH from msg.value) → TAKE(token)
 *  - ERC-20 in (sell): SWAP → SETTLE_ALL(token via Permit2) → TAKE(ETH); needs a Permit2 allowance
 *    for the router (see TradePanel: ERC-20 approve to Permit2 + Permit2.approve).
 */
export function buildV4ExactInSwap(args: {
  router: Address;
  key: PoolKey;
  currencyIn: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
}): SwapCall {
  const { router, key, currencyIn, amountIn, minAmountOut, deadline } = args;
  const inLc = currencyIn.toLowerCase();
  const zeroForOne = inLc === key.currency0.toLowerCase();
  const currencyOut = zeroForOne ? key.currency1 : key.currency0;
  const nativeIn = inLc === ZERO_ADDRESS;
  const swap = exactInSingle(key, zeroForOne, amountIn, minAmountOut);
  const input = nativeIn
    ? v4SwapInput(
        [ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE, ACT_TAKE],
        [
          swap,
          encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [ZERO_ADDRESS, amountIn, false]),
          encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [currencyOut, MSG_SENDER, OPEN_DELTA]),
        ],
      )
    : v4SwapInput(
        [ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE_ALL, ACT_TAKE],
        [
          swap,
          encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyIn, amountIn]),
          encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [currencyOut, MSG_SENDER, OPEN_DELTA]),
        ],
      );
  const commands = ("0x" + CMD_V4_SWAP.toString(16).padStart(2, "0")) as Hex;
  return {
    to: router,
    data: encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [commands, [input], deadline] }),
    value: nativeIn ? amountIn : 0n,
  };
}
