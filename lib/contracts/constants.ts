// Verified BNB Smart Chain (chainId 56) contract configuration.
//
// Launch/bonding-curve infrastructure (never shown in the UI):
//   * docs.flap.sh/flap/developers/deployed-contract-addresses  ("BNB Smart Chain Mainnet")
//   * github.com/flap-sh/FlapVaultExample  test/FlapBSCFixture.sol  (commit 5949cc7, 2026-09-23)
//   Both sources list identical values for every address below.
//
// PancakeSwap v2:
//   * developer.pancakeswap.finance/contracts/v2/addresses  (BNB Smart Chain mainnet)
//
// This module is dependency-free so it can be imported from pure logic and tests.

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const BSC_CHAIN_ID = 56 as const;
export const BSC_CHAIN_ID_HEX = "0x38" as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as Hex;

/** Launch protocol Portal (proxy). Creates tokens, runs the bonding curve, quotes and swaps. */
export const PORTAL_ADDRESS = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0" as Address;

/** "Standard Token Impl" — clone implementation for non-tax tokens (TokenVersion.TOKEN_V2_PERMIT). */
export const STANDARD_TOKEN_IMPL = "0x8B4329947e34B6d56D71A3385caC122BaDe7d78D" as Address;

/** "Tax Token V3 Impl" — clone implementation for TokenVersion.TOKEN_TAXED_V3. */
export const TAX_TOKEN_V3_IMPL = "0x024f18294970B5c76c0691b87f138A0317156422" as Address;

/** Required vanity suffixes of the CREATE2 clone address (lower-case hex, no 0x). */
export const VANITY_SUFFIX_STANDARD = "8888";
export const VANITY_SUFFIX_TAX = "7777";

/** EIP-1167 minimal-proxy init code, as used by ClonesUpgradeable.cloneDeterministic. */
export const CLONE_INIT_CODE_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73";
export const CLONE_INIT_CODE_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

export const PANCAKE_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" as Address;
export const PANCAKE_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as Address;

/**
 * Candidate ERC-20 quote assets on BSC. These are NOT assumed to be supported:
 * each one is shown in the UI only if Portal.getQuoteTokenConfiguration(addr).enabled == 1
 * at request time (see lib/market/quote-tokens.ts). Symbols and decimals are read on-chain.
 * Addresses verified on bscscan.com token pages.
 */
export const QUOTE_TOKEN_CANDIDATES: readonly Address[] = [
  "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", // USD1 (World Liberty Financial USD)
  "0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5", // lisUSD (Lista USD)
  "0x55d398326f99059fF775485246999027B3197955", // USDT (Binance-Peg BSC-USD)
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC (Binance-Peg)
] as const;

// ---- Protocol enums (values = Solidity declaration order in IPortal.sol) ----

export const TokenStatus = { Invalid: 0, Tradable: 1, InDuel: 2, Killed: 3, DEX: 4, Staged: 5 } as const;

export const TokenVersion = {
  TOKEN_LEGACY_MINT_NO_PERMIT: 0,
  TOKEN_LEGACY_MINT_NO_PERMIT_DUPLICATE: 1,
  TOKEN_V2_PERMIT: 2,
  TOKEN_GOPLUS: 3,
  TOKEN_TAXED: 4,
  TOKEN_TAXED_V2: 5,
  TOKEN_TAXED_V3: 6,
  TOKEN_V3_PERMIT: 7,
} as const;

export const DexThreshType = { TWO_THIRDS: 0, FOUR_FIFTHS: 1, HALF: 2, _95_PERCENT: 3, _81_PERCENT: 4, _1_PERCENT: 5 } as const;
export const MigratorType = { V3_MIGRATOR: 0, V2_MIGRATOR: 1, V4_UNI_MIGRATOR: 2, PCS_INFINITY_CL_MIGRATOR: 3 } as const;
export const DEXId = { DEX0: 0, DEX1: 1, DEX2: 2 } as const;
export const V3LPFeeProfile = { LP_FEE_PROFILE_STANDARD: 0, LP_FEE_PROFILE_LOW: 1, LP_FEE_PROFILE_HIGH: 2 } as const;

/**
 * Launch defaults used by mapin.
 * - FOUR_FIFTHS graduation threshold (used by the protocol's own mainnet fork fixture).
 * - V2 migrator so every graduated market lands in a PancakeSwap v2 pair
 *   (tax tokens can only use V2 anyway), which the app then verifies and trades on-chain.
 * - DEX0 = PancakeSwap on BSC.
 */
export const LAUNCH_DEFAULTS = {
  dexThresh: DexThreshType.FOUR_FIFTHS,
  migratorType: MigratorType.V2_MIGRATOR,
  dexId: DEXId.DEX0,
  lpFeeProfile: V3LPFeeProfile.LP_FEE_PROFILE_STANDARD,
} as const;

/** Extra msg.value required when launching a tax token paired with an ERC-20 quote (IPortal.sol newTokenV2 note). */
export const TAX_TOKEN_ERC20_QUOTE_EXTRA_VALUE = 1_000_000_000n; // 1 gwei

/** Chain aliases used across the app. */
export const CHAIN_ID = BSC_CHAIN_ID;
export const CHAIN_NAME = "BNB Smart Chain";
