// Pure construction of a Pons v2 launch: factory.launchToken (no initial buy, or any ERC-20 pair such
// as a Robinhood stock token) or the atomic launch-and-buy router (ETH pair with an initial buy). Field order follows TokenParams in
// PonsV2LaunchFactory (github.com/ponsdotdev/pons-labs) as verified on chain 4663.

import {
  NATIVE_PAIR,
  PONS_FACTORY,
  PONS_LAUNCH_CONFIG_ID,
  PONS_LAUNCH_ROUTER,
  PONS_METADATA_LIMITS,
  ZERO_ADDRESS,
  type Address,
  type Hex,
} from "../contracts/constants.ts";
import { ValidationError, isHexAddress, normalizeSymbol, normalizeTokenName } from "../validation/normalize.ts";
import { buyMinTokensOut, quoteOpeningBuy } from "../market/curve-math.ts";

/** mapin product cap for the owner fee (the protocol's own cap is read live and may be lower). */
export const MAX_CREATOR_FEE_BPS = 1_000; // 10 %
/** Slippage on the atomic opening buy (it executes in the launch transaction, so the curve is fresh). */
export const OPENING_BUY_SLIPPAGE_BPS = 500;

export interface TokenParams {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  expectedEconomics: Hex;
  salt: Hex;
}

export interface LaunchTermsInput {
  launchFee: bigint;
  maxCreatorTaxBps: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  expectedEconomics: Hex;
  /** factory.launchForwarder() read live */
  launchForwarder: Address;
  /** pair asset these terms were read for (zero address = native ETH) */
  pairToken: Address;
  /** factory.approvedPairTokens(pairToken) (always true for ETH) */
  pairApproved: boolean;
}

export interface LaunchConfig {
  name: string;
  symbol: string;
  logoUrl: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  creator: Address;
  /** Pons creatorFeeRecipient: on mapin always the owner escrow (the launcher is not paid the fee) */
  feeRecipient: Address;
  creatorFeeBps: number;
  /** opening buy in the pair asset's raw units (0 = none) */
  initialBuy: bigint;
  salt: Hex;
  terms: LaunchTermsInput;
}

/**
 * Opening buy for an ERC-20 pair (stock token / USDG): sent right after the launch as a normal curve
 * buy (ERC-20 approve to the new curve, then curve.buy). The creator is exempt from the snipe tax.
 */
export interface FollowUpBuy {
  amount: bigint;
  expectedTokens: bigint;
  minTokensOut: bigint;
}

export type LaunchPlan =
  | {
      route: "factory";
      to: Address;
      params: TokenParams;
      /** launchToken(params, configId, pairToken, exemptions) */
      args: readonly [TokenParams, bigint, Address, readonly Address[]];
      value: bigint;
      expectedTokens: null;
      followUpBuy: FollowUpBuy | null;
    }
  | {
      route: "router";
      to: Address;
      params: TokenParams;
      /** launchAndBuy(params, configId, pairToken, quoteIn, minTokensOut, recipient, exemptions) */
      args: readonly [TokenParams, bigint, Address, bigint, bigint, Address, readonly Address[]];
      value: bigint;
      expectedTokens: bigint;
      followUpBuy: null;
    };

const byteLen = (s: string) => new TextEncoder().encode(s).length;

function checkLen(field: string, value: string, limit: number) {
  if (byteLen(value) > limit) throw new ValidationError(`${field} is too long (max ${limit} bytes)`);
}

export function validateCreatorFee(bps: number, protocolMax: bigint): void {
  if (!Number.isInteger(bps) || bps < 0) throw new ValidationError("Creator fee must be whole basis points");
  if (bps > MAX_CREATOR_FEE_BPS) throw new ValidationError(`Creator fee is capped at ${MAX_CREATOR_FEE_BPS / 100}%`);
  if (BigInt(bps) > protocolMax) throw new ValidationError(`Creator fee is capped at ${Number(protocolMax) / 100}% by the protocol`);
}

export function buildLaunchPlan(cfg: LaunchConfig): LaunchPlan {
  const name = normalizeTokenName(cfg.name);
  const symbol = normalizeSymbol(cfg.symbol);
  if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.salt)) throw new ValidationError("Salt must be 32 bytes");
  if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.terms.expectedEconomics) || /^0x0{64}$/.test(cfg.terms.expectedEconomics)) {
    throw new ValidationError("Launch economics could not be read from the chain. Retry.");
  }
  if (!isHexAddress(cfg.creator) || cfg.creator.toLowerCase() === ZERO_ADDRESS) throw new ValidationError("Invalid creator wallet");
  if (!isHexAddress(cfg.feeRecipient) || cfg.feeRecipient.toLowerCase() === ZERO_ADDRESS) throw new ValidationError("Owner escrow address is not configured");
  if (cfg.initialBuy < 0n) throw new ValidationError("Initial buy cannot be negative");
  if (!/^https?:\/\//.test(cfg.logoUrl)) throw new ValidationError("Logo URL must be an http(s) URL");
  validateCreatorFee(cfg.creatorFeeBps, cfg.terms.maxCreatorTaxBps);
  const pairToken = cfg.terms.pairToken;
  const native = pairToken.toLowerCase() === NATIVE_PAIR;
  if (!native && !cfg.terms.pairApproved) throw new ValidationError("This pair asset is not accepted by the launch contract right now.");

  const L = PONS_METADATA_LIMITS;
  checkLen("Token name", name, L.name);
  checkLen("Ticker", symbol, L.symbol);
  checkLen("Logo URL", cfg.logoUrl, L.logo);
  checkLen("Description", cfg.description, L.description);
  checkLen("Website", cfg.website, L.social);
  checkLen("X / Twitter", cfg.twitter, L.social);
  checkLen("Telegram", cfg.telegram, L.social);

  const params: TokenParams = {
    name,
    symbol,
    logo: cfg.logoUrl,
    description: cfg.description,
    socials: { twitter: cfg.twitter, telegram: cfg.telegram, discord: "", website: cfg.website, farcaster: "" },
    creatorFeeRecipient: cfg.feeRecipient,
    creatorTaxBps: cfg.creatorFeeBps,
    buybackEnabled: false,
    expectedEconomics: cfg.terms.expectedEconomics,
    salt: cfg.salt,
  };

  const opening = () => {
    const q = quoteOpeningBuy(
      { supply: cfg.terms.supply, curveFeeBps: cfg.terms.curveFeeBps, phantomQuote: cfg.terms.phantomQuote, graduationThreshold: cfg.terms.graduationThreshold },
      BigInt(cfg.creatorFeeBps),
      cfg.initialBuy,
    );
    return { expectedTokens: q.tokensOut, minTokensOut: buyMinTokensOut(q, OPENING_BUY_SLIPPAGE_BPS) };
  };

  if (cfg.initialBuy === 0n || !native) {
    return {
      route: "factory",
      to: PONS_FACTORY,
      params,
      args: [params, PONS_LAUNCH_CONFIG_ID, pairToken, []],
      value: cfg.terms.launchFee, // the factory requires msg.value == launchFee exactly (paid in ETH for every pair)
      expectedTokens: null,
      followUpBuy: cfg.initialBuy > 0n ? { amount: cfg.initialBuy, ...opening() } : null,
    };
  }

  // The router is owner-rotatable on the factory: never send value to an address we did not pin.
  if (cfg.terms.launchForwarder.toLowerCase() !== PONS_LAUNCH_ROUTER.toLowerCase()) {
    throw new ValidationError("The launch router changed on-chain and has not been verified by mapin. Launch without an initial buy, or try again later.");
  }
  const o = opening();
  return {
    route: "router",
    to: PONS_LAUNCH_ROUTER,
    params,
    args: [params, PONS_LAUNCH_CONFIG_ID, NATIVE_PAIR, cfg.initialBuy, o.minTokensOut, cfg.creator, []],
    value: cfg.terms.launchFee + cfg.initialBuy,
    expectedTokens: o.expectedTokens,
    followUpBuy: null,
  };
}

/** Random 32-byte CREATE2 salt (a fresh salt per attempt, so a retried launch never collides). */
export function randomSalt(): Hex {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
}
