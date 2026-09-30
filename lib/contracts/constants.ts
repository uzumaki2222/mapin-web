// Verified Robinhood Chain (chainId 4663) contract configuration.
//
// Launch / bonding-curve / graduation infrastructure: the Pons v2 launchpad.
//   * github.com/ponsmcp/pons-mcp  docs/PROTOCOL.md — addresses verified from live chain state and
//     cross-checked against the Sourcify-verified sources (exact match) on chain 4663
//   * github.com/ponsdotdev/pons-labs — official contract sources (PonsV2LaunchFactory,
//     PonsV2BondingCurve, PonsV2LaunchDeployer, PonsV2LauncherToken)
//   * Bitquery "Pons Launchpad on Robinhood Chain" guide — same factory / router / hook addresses
//
// Graduated markets trade on Uniswap v4 (PoolManager + the chain's Universal Router fork).
//
// This module is dependency-free so it can be imported from pure logic and tests.

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const CHAIN_ID = 4663 as const;
export const CHAIN_ID_HEX = "0x1237" as const;
export const CHAIN_NAME = "Robinhood Chain";
export const NATIVE_SYMBOL = "ETH";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as Hex;

/** Pons v2 launch factory: launches, launch config, graduation, creator fee recipient. */
export const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;

/**
 * Pons atomic launch-and-buy router (the factory's `launchForwarder()`). Used when the creator
 * makes an initial buy in the launch transaction. It is owner-rotatable on the factory, so the app
 * reads `launchForwarder()` live and refuses to send value if it differs from this pinned address.
 */
export const PONS_LAUNCH_ROUTER = "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948" as Address;

/** Hook attached to every graduated Pons pool (part of the Uniswap v4 pool key). */
export const PONS_MEME_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as Address;

// ---- Uniswap v4 on Robinhood Chain (graduated markets) ----
export const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address;
export const V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as Address;
export const V4_STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as Address;
/** Universal Router (a fork: its V3 command is non-standard; the stock V4_SWAP command works). */
export const UNIVERSAL_ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904" as Address;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

/** Pons launch config used by mapin (config 0: 1B supply, 1% curve fee, 4.2 ETH graduation). */
export const PONS_LAUNCH_CONFIG_ID = 0n;

/** Pons' native-ETH pair sentinel (the zero address — not WETH). Exempt from the pair approval check. */
export const NATIVE_PAIR = ZERO_ADDRESS;

/**
 * Block the current Pons v2 factory was deployed at. ERC-20 pair assets (Robinhood stock tokens, USDG, …)
 * are discovered from the factory's PairTokenApprovalUpdated history starting here, never hardcoded:
 * the protocol owner approves and revokes pair assets at any time.
 */
export const PONS_FACTORY_START_BLOCK = 26_841_846n;

/** Pons launch token metadata byte limits (PonsV2LaunchDeployer). */
export const PONS_METADATA_LIMITS = {
  name: 64,
  symbol: 16,
  logo: 512,
  description: 2048,
  social: 256,
} as const;

/** `getLaunchedToken(token).phase` (GraduationPhase enum). */
export const GraduationPhase = { NotGraduated: 0, Swept: 1, PoolCreated: 2, Rescued: 3 } as const;

/** Protocol version recorded in markets.token_version for Pons v2 launches. */
export const PONS_TOKEN_VERSION = 2;
