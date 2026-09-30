// Hand-written ABIs for the pieces of Pons / Uniswap v4 that are not in the generated file.
// Signatures and selectors are the ones verified on chain 4663 in github.com/ponsmcp/pons-mcp
// (src/abi.ts asserts every selector against its canonical signature at load time).

import { ponsErrorsAbi } from "./pons-abi.generated.ts";

export { ponsFactoryAbi, ponsCurveAbi, ponsErrorsAbi } from "./pons-abi.generated.ts";

const tokenParamsComponents = [
  { name: "name", type: "string" },
  { name: "symbol", type: "string" },
  { name: "logo", type: "string" },
  { name: "description", type: "string" },
  {
    name: "socials",
    type: "tuple",
    components: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" },
    ],
  },
  { name: "creatorFeeRecipient", type: "address" },
  { name: "creatorTaxBps", type: "uint16" },
  { name: "buybackEnabled", type: "bool" },
  { name: "expectedEconomics", type: "bytes32" },
  { name: "salt", type: "bytes32" },
] as const;

/**
 * PonsV2LaunchAndBuy — the factory's `launchForwarder()`. Launches for msg.sender (via the factory's
 * launchTokenFor) and makes the opening buy atomically. Selector 0xf85f8e41.
 */
export const ponsLaunchRouterAbi = [
  {
    type: "function",
    name: "launchAndBuy",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: tokenParamsComponents },
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
      { name: "quoteIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "snipeTaxExemptions", type: "address[]" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
    ],
  },
  ...ponsErrorsAbi,
] as const;

/** Snipe-tax read present on live curves (decays to 0 a few seconds after launch). */
export const ponsCurveSnipeAbi = [
  {
    type: "function",
    name: "currentSnipeTaxBps",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** PonsV2LauncherToken metadata stored on-chain at launch. */
export const ponsTokenAbi = [
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "deployer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "curve", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "socials",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" },
    ],
  },
] as const;

const poolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

export const poolKeyAbiParameter = { name: "key", type: "tuple", components: poolKeyComponents } as const;

/** Uniswap v4 V4Quoter.quoteExactInputSingle (non-view; evaluated with eth_call). */
export const v4QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: poolKeyComponents },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const v4StateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

export const universalRouterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Permit2 AllowanceTransfer: on-chain approve (no typed-data signature needed). */
export const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/** Uniswap v4 PoolManager Swap event (id = poolId). amounts are from the swapper's perspective (negative = paid in). */
export const v4PoolManagerAbi = [
  {
    type: "event",
    name: "Swap",
    anonymous: false,
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
    ],
  },
] as const;
