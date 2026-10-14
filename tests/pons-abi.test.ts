// Every selector / event topic mapin sends or listens to, checked against the values
// verified live on Robinhood Chain (chain 4663) by github.com/ponsmcp/pons-mcp (src/abi.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import {
  permit2Abi, ponsCurveAbi, ponsCurveSnipeAbi, ponsFactoryAbi, ponsLaunchRouterAbi, ponsTokenAbi,
  universalRouterAbi, v4QuoterAbi, v4StateViewAbi,
} from "../lib/contracts/pons-abi.ts";

const fn = (abi: readonly unknown[], name: string, inputs?: number) =>
  (abi as AbiFunction[]).filter((x) => x.type === "function" && x.name === name && (inputs === undefined || x.inputs.length === inputs));
const sel = (abi: readonly unknown[], name: string, inputs?: number) => {
  const f = fn(abi, name, inputs);
  assert.equal(f.length, 1, `${name} must exist exactly once`);
  return toFunctionSelector(f[0]!);
};
const topic = (abi: readonly unknown[], name: string) =>
  toEventSelector((abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!);

test("factory selectors match the verified chain-4663 values", () => {
  assert.equal(sel(ponsFactoryAbi, "launchToken", 4), "0xa72101af");
  assert.equal(sel(ponsFactoryAbi, "launchFee"), "0xcf3cf573");
  assert.equal(sel(ponsFactoryAbi, "launchEnabled"), "0x236a4afb");
  assert.equal(sel(ponsFactoryAbi, "maxCreatorTaxBps"), "0xf325a5fb");
  assert.equal(sel(ponsFactoryAbi, "getLaunchConfig"), "0x1cad862d");
  assert.equal(sel(ponsFactoryAbi, "getLaunchedToken"), "0x3cf28b5a");
  assert.equal(sel(ponsFactoryAbi, "previewLaunchEconomics"), "0xf718b78c");
  assert.equal(sel(ponsFactoryAbi, "launchForwarder"), "0x9b924452");
  assert.equal(sel(ponsFactoryAbi, "memeHook"), "0x6651812c");
  assert.equal(sel(ponsFactoryAbi, "graduate"), "0xff6d8d05");
  assert.equal(sel(ponsFactoryAbi, "createGraduatedPool"), "0x2f53ef2f");
});

test("router, curve, token and v4 selectors match", () => {
  assert.equal(sel(ponsLaunchRouterAbi, "launchAndBuy"), "0xf85f8e41");
  assert.equal(sel(ponsCurveAbi, "buy"), "0x59a87bc1");
  assert.equal(sel(ponsCurveAbi, "sell"), "0xd04c6983");
  assert.equal(sel(ponsCurveAbi, "getReserves"), "0x0902f1ac");
  assert.equal(sel(ponsCurveAbi, "readyToGraduate"), "0xc68360a5");
  assert.equal(sel(ponsCurveAbi, "realQuoteReserve"), "0x4f1f58fd");
  assert.equal(sel(ponsCurveAbi, "reservedTokens"), "0x15a55347");
  assert.equal(sel(ponsCurveAbi, "feeBps"), "0x24a9d853");
  assert.equal(sel(ponsCurveSnipeAbi, "currentSnipeTaxBps"), "0xd7e1ef39");
  assert.equal(sel(v4QuoterAbi, "quoteExactInputSingle"), "0xaa9d21cb");
  assert.equal(sel(v4StateViewAbi, "getSlot0"), "0xc815641c");
  assert.equal(sel(v4StateViewAbi, "getLiquidity"), "0xfa6793d5");
  assert.equal(sel(universalRouterAbi, "execute"), "0x3593564c");
  assert.equal(sel(permit2Abi, "allowance"), "0x927da105");
  assert.equal(sel(ponsTokenAbi, "logo"), toFunctionSelector("logo()"));
});

test("event topics match", () => {
  assert.equal(topic(ponsFactoryAbi, "TokenLaunched"), "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607");
  assert.equal(topic(ponsFactoryAbi, "PoolGraduated"), "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259");
  assert.equal(topic(ponsCurveAbi, "CurveBuy"), "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455");
  assert.equal(topic(ponsCurveAbi, "CurveSell"), "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df");
});
