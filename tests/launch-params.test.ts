import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import { buildLaunchPlan, randomSalt, type LaunchConfig } from "../lib/launch/params.ts";
import { PONS_FACTORY, PONS_LAUNCH_ROUTER, ZERO_ADDRESS } from "../lib/contracts/constants.ts";
import { ponsFactoryAbi, ponsLaunchRouterAbi } from "../lib/contracts/pons-abi.ts";
import { ValidationError } from "../lib/validation/normalize.ts";

const E = 10n ** 18n;
const creator = "0x1234567890abcdef1234567890abcdef12345678" as Address;
const escrow = "0xe5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0" as Address;
const terms = {
  launchFee: 5n * 10n ** 14n, // 0.0005 ETH
  maxCreatorTaxBps: 1000n,
  supply: 1_000_000_000n * E,
  curveFeeBps: 100n,
  phantomQuote: 168n * E / 100n,
  graduationThreshold: 42n * E / 10n,
  expectedEconomics: ("0x" + "ab".repeat(32)) as Hex,
  launchForwarder: PONS_LAUNCH_ROUTER,
  pairToken: ZERO_ADDRESS as Address,
  pairApproved: true,
};
const TSLA = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1" as Address;
const base: LaunchConfig = {
  name: "Warung Sari Rasa", symbol: "wsr", logoUrl: "https://mapin.example/api/ipfs/bafkreiabc", description: "A warung",
  website: "https://mapin.example/b/warung-sari-rasa-a1b2c3", twitter: "", telegram: "", creator, feeRecipient: escrow, creatorFeeBps: 70, initialBuy: 0n,
  salt: ("0x" + "cd".repeat(32)) as Hex, terms,
};

test("no initial buy → factory.launchToken with msg.value == launchFee", () => {
  const p = buildLaunchPlan(base);
  assert.equal(p.route, "factory");
  assert.equal(p.to, PONS_FACTORY);
  assert.equal(p.value, terms.launchFee);
  assert.equal(p.params.symbol, "WSR");
  assert.equal(p.params.socials.website, "https://mapin.example/b/warung-sari-rasa-a1b2c3");
  assert.equal(p.params.creatorFeeRecipient, escrow);
  assert.equal(p.params.creatorTaxBps, 70);
  assert.equal(p.params.expectedEconomics, terms.expectedEconomics);
  assert.equal(p.args[2], ZERO_ADDRESS); // native ETH pair
  if (p.route !== "factory") throw new Error("route");
  const data = encodeFunctionData({ abi: ponsFactoryAbi, functionName: "launchToken", args: p.args });
  assert.equal(data.slice(0, 10), "0xa72101af");
  const back = decodeFunctionData({ abi: ponsFactoryAbi, data });
  assert.equal((back.args![0] as { name: string }).name, "Warung Sari Rasa");
});

test("initial buy → atomic launchAndBuy through the pinned router", () => {
  const p = buildLaunchPlan({ ...base, initialBuy: E / 10n, creatorFeeBps: 250 });
  assert.equal(p.route, "router");
  if (p.route !== "router") throw new Error("route");
  assert.equal(p.to, PONS_LAUNCH_ROUTER);
  assert.equal(p.value, terms.launchFee + E / 10n);
  assert.equal(p.args[3], E / 10n);
  assert.ok(p.args[4] > 0n && p.args[4] < p.expectedTokens);
  assert.equal(p.args[5], creator); // opening-buy tokens go to the launcher
  assert.equal(p.params.creatorFeeRecipient, escrow); // the fee never does
  assert.equal(p.params.creatorTaxBps, 250);
  const data = encodeFunctionData({ abi: ponsLaunchRouterAbi, functionName: "launchAndBuy", args: p.args });
  assert.equal(data.slice(0, 10), "0xf85f8e41");
});

test("refuses an unverified launch router", () => {
  assert.throws(() => buildLaunchPlan({ ...base, initialBuy: 1n, terms: { ...terms, launchForwarder: "0x9999999999999999999999999999999999999999" } }), ValidationError);
  // without an initial buy the router is not used, so drift does not matter
  assert.equal(buildLaunchPlan({ ...base, terms: { ...terms, launchForwarder: "0x9999999999999999999999999999999999999999" } }).route, "factory");
});

test("validation", () => {
  assert.throws(() => buildLaunchPlan({ ...base, creatorFeeBps: 1001 }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, feeRecipient: ZERO_ADDRESS }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, creatorFeeBps: 600, terms: { ...terms, maxCreatorTaxBps: 500n } }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, terms: { ...terms, expectedEconomics: ("0x" + "0".repeat(64)) as Hex } }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, logoUrl: "ipfs://x" }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, description: "x".repeat(2049) }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, creator: ZERO_ADDRESS }), ValidationError);
  assert.match(randomSalt(), /^0x[0-9a-f]{64}$/);
  assert.notEqual(randomSalt(), randomSalt());
});

test("stock-token pair → factory launch (fee in ETH) + separate curve buy", () => {
  const stockTerms = { ...terms, pairToken: TSLA, phantomQuote: 5n * E, graduationThreshold: 12n * E };
  const p = buildLaunchPlan({ ...base, initialBuy: 2n * E, terms: stockTerms });
  assert.equal(p.route, "factory");
  if (p.route !== "factory") throw new Error("route");
  assert.equal(p.args[2], TSLA);
  assert.equal(p.value, terms.launchFee); // no stock amount in msg.value
  assert.ok(p.followUpBuy);
  assert.equal(p.followUpBuy!.amount, 2n * E);
  assert.ok(p.followUpBuy!.minTokensOut > 0n && p.followUpBuy!.minTokensOut < p.followUpBuy!.expectedTokens);
  // no initial buy → no follow-up
  const q = buildLaunchPlan({ ...base, terms: stockTerms });
  assert.equal(q.route === "factory" ? q.followUpBuy : "x", null);
  // a revoked / unapproved asset is refused before anything is sent
  assert.throws(() => buildLaunchPlan({ ...base, terms: { ...stockTerms, pairApproved: false } }), ValidationError);
});
