// Pure construction of Portal.newTokenV6(NewTokenV6Params) arguments.
// Field order and semantics follow contracts-reference/IPortal.sol (NewTokenV6Params).

import {
  LAUNCH_DEFAULTS,
  STANDARD_TOKEN_IMPL,
  TAX_TOKEN_ERC20_QUOTE_EXTRA_VALUE,
  TAX_TOKEN_V3_IMPL,
  TokenVersion,
  VANITY_SUFFIX_STANDARD,
  VANITY_SUFFIX_TAX,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  type Address,
  type Hex,
} from "../contracts/constants.ts";
import { ValidationError, isHexAddress, normalizeSymbol, normalizeTokenName } from "../validation/normalize.ts";

export const MAX_TAX_BPS = 1_000; // mapin product cap: 10 %
export const DAY = 86_400n;
export const MIN_TAX_DURATION = 30n * DAY;
export const MAX_TAX_DURATION = 100n * 365n * DAY; // protocol maximum per IPortal.sol
export const MIN_ANTI_FARMER = 60n * 60n; // 1 hour
export const MAX_ANTI_FARMER = 365n * DAY; // protocol maximum per IPortal.sol

export interface TaxConfig {
  buyBps: number;
  sellBps: number;
  durationSeconds: bigint;
  antiFarmerSeconds: bigint;
  /** share of collected tax routed to the creator wallet (beneficiary) */
  marketBps: number;
  /** share burned */
  deflationBps: number;
  /** share added to liquidity */
  lpBps: number;
}

export interface LaunchConfig {
  name: string;
  symbol: string;
  metaCid: string;
  salt: Hex;
  quoteToken: Address; // ZERO_ADDRESS = native BNB
  initialBuy: bigint; // raw quote units
  creator: Address;
  tax: TaxConfig | null;
}

/** Shape viem expects for the tuple (uint8/uint16 → number, uint64/uint256 → bigint). */
export interface NewTokenV6Args {
  name: string;
  symbol: string;
  meta: string;
  dexThresh: number;
  salt: Hex;
  migratorType: number;
  quoteToken: Address;
  quoteAmt: bigint;
  beneficiary: Address;
  permitData: Hex;
  extensionID: Hex;
  extensionData: Hex;
  dexId: number;
  lpFeeProfile: number;
  buyTaxRate: number;
  sellTaxRate: number;
  taxDuration: bigint;
  antiFarmerDuration: bigint;
  mktBps: number;
  deflationBps: number;
  dividendBps: number;
  lpBps: number;
  minimumShareBalance: bigint;
  dividendToken: Address;
  commissionReceiver: Address;
  tokenVersion: number;
}

export interface LaunchPlan {
  args: NewTokenV6Args;
  /** msg.value to send with newTokenV6 */
  value: bigint;
  /** ERC-20 quote amount Portal must be approved to pull (0 for native) */
  erc20Approval: bigint;
  tokenVersion: number;
  tokenImpl: Address;
  vanitySuffix: string;
  isTax: boolean;
}

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;

export function isNative(quoteToken: string): boolean {
  return quoteToken.toLowerCase() === ZERO_ADDRESS;
}

export function validateTaxConfig(tax: TaxConfig): void {
  const ints = [tax.buyBps, tax.sellBps, tax.marketBps, tax.deflationBps, tax.lpBps];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0)) throw new ValidationError("Tax values must be whole basis points");
  if (tax.buyBps > MAX_TAX_BPS || tax.sellBps > MAX_TAX_BPS) {
    throw new ValidationError(`Buy and sell tax are capped at ${MAX_TAX_BPS / 100}%`);
  }
  if (tax.buyBps === 0 && tax.sellBps === 0) throw new ValidationError("A tax market needs a buy or sell tax above 0%");
  if (tax.marketBps + tax.deflationBps + tax.lpBps !== 10_000) {
    throw new ValidationError("Tax revenue split must add up to 100%");
  }
  if (tax.durationSeconds < MIN_TAX_DURATION || tax.durationSeconds > MAX_TAX_DURATION) {
    throw new ValidationError("Tax duration must be between 30 days and 100 years");
  }
  if (tax.antiFarmerSeconds < MIN_ANTI_FARMER || tax.antiFarmerSeconds > MAX_ANTI_FARMER) {
    throw new ValidationError("Anti-farming window must be between 1 hour and 365 days");
  }
}

export function buildLaunchPlan(cfg: LaunchConfig): LaunchPlan {
  const name = normalizeTokenName(cfg.name);
  const symbol = normalizeSymbol(cfg.symbol);
  if (!CID_RE.test(cfg.metaCid)) throw new ValidationError("Metadata identifier is not a valid IPFS CID");
  if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.salt)) throw new ValidationError("Salt must be 32 bytes");
  if (!isHexAddress(cfg.quoteToken)) throw new ValidationError("Invalid pair asset");
  if (!isHexAddress(cfg.creator) || cfg.creator.toLowerCase() === ZERO_ADDRESS) throw new ValidationError("Invalid creator wallet");
  if (cfg.initialBuy < 0n) throw new ValidationError("Initial buy cannot be negative");

  const native = isNative(cfg.quoteToken);
  const isTax = cfg.tax !== null;
  if (cfg.tax) validateTaxConfig(cfg.tax);

  const tokenVersion = isTax ? TokenVersion.TOKEN_TAXED_V3 : TokenVersion.TOKEN_V2_PERMIT;

  const args: NewTokenV6Args = {
    name,
    symbol,
    meta: cfg.metaCid,
    dexThresh: LAUNCH_DEFAULTS.dexThresh,
    salt: cfg.salt,
    migratorType: LAUNCH_DEFAULTS.migratorType,
    quoteToken: cfg.quoteToken,
    quoteAmt: cfg.initialBuy,
    beneficiary: cfg.creator,
    permitData: "0x",
    extensionID: ZERO_BYTES32,
    extensionData: "0x",
    dexId: LAUNCH_DEFAULTS.dexId,
    lpFeeProfile: LAUNCH_DEFAULTS.lpFeeProfile,
    buyTaxRate: cfg.tax?.buyBps ?? 0,
    sellTaxRate: cfg.tax?.sellBps ?? 0,
    taxDuration: cfg.tax?.durationSeconds ?? 0n,
    antiFarmerDuration: cfg.tax?.antiFarmerSeconds ?? 0n,
    mktBps: cfg.tax?.marketBps ?? 0,
    deflationBps: cfg.tax?.deflationBps ?? 0,
    dividendBps: 0,
    lpBps: cfg.tax?.lpBps ?? 0,
    minimumShareBalance: 0n,
    // address(0) = native dividend, only valid with a native quote; with an ERC-20 quote the
    // quote token itself is the explicitly-allowed choice. dividendBps is 0 either way.
    dividendToken: native || !isTax ? ZERO_ADDRESS : cfg.quoteToken,
    commissionReceiver: ZERO_ADDRESS, // MUST be zero for non-tax tokens; unused for tax tokens
    tokenVersion,
  };

  let value = 0n;
  let erc20Approval = 0n;
  if (native) {
    value = cfg.initialBuy; // msg.value must equal quoteAmt
  } else {
    erc20Approval = cfg.initialBuy;
    if (isTax) value = TAX_TOKEN_ERC20_QUOTE_EXTRA_VALUE;
  }

  return {
    args,
    value,
    erc20Approval,
    tokenVersion,
    tokenImpl: isTax ? TAX_TOKEN_V3_IMPL : STANDARD_TOKEN_IMPL,
    vanitySuffix: isTax ? VANITY_SUFFIX_TAX : VANITY_SUFFIX_STANDARD,
    isTax,
  };
}

/** Which clone implementation / suffix a launch needs, before the salt is known. */
export function vanityTargetFor(isTax: boolean): { tokenImpl: Address; suffix: string } {
  return isTax
    ? { tokenImpl: TAX_TOKEN_V3_IMPL, suffix: VANITY_SUFFIX_TAX }
    : { tokenImpl: STANDARD_TOKEN_IMPL, suffix: VANITY_SUFFIX_STANDARD };
}
