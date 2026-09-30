import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchPlan, vanityTargetFor, DAY, type LaunchConfig } from "../lib/launch/params.ts";
import {
  STANDARD_TOKEN_IMPL, TAX_TOKEN_V3_IMPL, TokenVersion, ZERO_ADDRESS, DexThreshType, MigratorType,
} from "../lib/contracts/constants.ts";
import { ValidationError } from "../lib/validation/normalize.ts";

const CID = "bafkreibwjuzzns6yf4wytfr5nk6vujb4yja4iejff2k76nshn2z5jkmiy4";
const USD1 = "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d";
const creator = "0x1234567890abcdef1234567890abcdef12345678" as const;
const salt = ("0x" + "ab".repeat(32)) as `0x${string}`;

const base: LaunchConfig = {
  name: "Coded Project", symbol: "code", metaCid: CID, salt, quoteToken: ZERO_ADDRESS,
  initialBuy: 10n ** 16n, creator, tax: null,
};

test("non-tax native launch", () => {
  const p = buildLaunchPlan(base);
  assert.equal(p.tokenVersion, TokenVersion.TOKEN_V2_PERMIT);
  assert.equal(p.tokenImpl, STANDARD_TOKEN_IMPL);
  assert.equal(p.vanitySuffix, "8888");
  assert.equal(p.value, 10n ** 16n); // msg.value == quoteAmt
  assert.equal(p.erc20Approval, 0n);
  assert.equal(p.args.symbol, "CODE");
  assert.equal(p.args.quoteAmt, 10n ** 16n);
  assert.equal(p.args.beneficiary, creator);
  assert.equal(p.args.buyTaxRate, 0);
  assert.equal(p.args.sellTaxRate, 0);
  assert.equal(p.args.mktBps, 0);
  assert.equal(p.args.commissionReceiver, ZERO_ADDRESS);
  assert.equal(p.args.dexThresh, DexThreshType.FOUR_FIFTHS);
  assert.equal(p.args.migratorType, MigratorType.V2_MIGRATOR);
  assert.equal(p.args.permitData, "0x");
  assert.equal(p.args.meta, CID);
  // field order must match NewTokenV6Params in IPortal.sol
  assert.deepEqual(Object.keys(p.args), [
    "name", "symbol", "meta", "dexThresh", "salt", "migratorType", "quoteToken", "quoteAmt", "beneficiary",
    "permitData", "extensionID", "extensionData", "dexId", "lpFeeProfile", "buyTaxRate", "sellTaxRate",
    "taxDuration", "antiFarmerDuration", "mktBps", "deflationBps", "dividendBps", "lpBps",
    "minimumShareBalance", "dividendToken", "commissionReceiver", "tokenVersion",
  ]);
});

const tax = { buyBps: 300, sellBps: 500, durationSeconds: 365n * DAY, antiFarmerSeconds: 3600n, marketBps: 8000, deflationBps: 1000, lpBps: 1000 };

test("tax launch with native quote", () => {
  const p = buildLaunchPlan({ ...base, tax });
  assert.equal(p.tokenVersion, TokenVersion.TOKEN_TAXED_V3);
  assert.equal(p.tokenImpl, TAX_TOKEN_V3_IMPL);
  assert.equal(p.vanitySuffix, "7777");
  assert.equal(p.args.buyTaxRate, 300);
  assert.equal(p.args.sellTaxRate, 500);
  assert.equal(p.args.mktBps + p.args.deflationBps + p.args.dividendBps + p.args.lpBps, 10_000);
  assert.equal(p.args.dividendToken, ZERO_ADDRESS);
  assert.equal(p.value, 10n ** 16n);
});

test("tax launch with ERC-20 quote needs approval and 1 gwei", () => {
  const p = buildLaunchPlan({ ...base, quoteToken: USD1, initialBuy: 5n * 10n ** 18n, tax });
  assert.equal(p.value, 1_000_000_000n);
  assert.equal(p.erc20Approval, 5n * 10n ** 18n);
  assert.equal(p.args.dividendToken, USD1);
  const nonTax = buildLaunchPlan({ ...base, quoteToken: USD1, initialBuy: 0n });
  assert.equal(nonTax.value, 0n);
  assert.equal(nonTax.erc20Approval, 0n);
});

test("launch validation", () => {
  assert.throws(() => buildLaunchPlan({ ...base, metaCid: "not-a-cid" }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, salt: "0x1234" }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, creator: ZERO_ADDRESS }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, initialBuy: -1n }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, tax: { ...tax, buyBps: 2000 } }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, tax: { ...tax, buyBps: 0, sellBps: 0 } }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, tax: { ...tax, lpBps: 0 } }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, tax: { ...tax, durationSeconds: DAY } }), ValidationError);
  assert.throws(() => buildLaunchPlan({ ...base, tax: { ...tax, antiFarmerSeconds: 10n } }), ValidationError);
  assert.deepEqual(vanityTargetFor(true), { tokenImpl: TAX_TOKEN_V3_IMPL, suffix: "7777" });
});
