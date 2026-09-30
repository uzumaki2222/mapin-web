// Contract integration check against BNB Smart Chain MAINNET — read-only.
//
// * encodes newTokenV6 calldata with viem from the verified ABI and decodes it back
// * confirms Portal + token implementations have bytecode, reads version / fees / pair assets
// * finds a real vanity salt and runs newTokenV6 through eth_call (simulation) for both
//   the tax-free and the tax market paths, printing the predicted token or decoded revert
// * optionally (CHECK_TOKEN=0x…) quotes and simulates a bonding-curve buy using a state
//   override for the balance of a throwaway address
//
// There is NO wallet client and NO private key in this script: it cannot broadcast anything.
// Usage:  npm run test:contracts      (uses RPC_URL from .env.local, else the official endpoint)

import "./load-env";
import { randomBytes } from "node:crypto";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  http,
  parseEther,
  getAddress,
} from "viem";
import { bsc } from "viem/chains";
import { portalAbi } from "../lib/contracts/portal-abi";
import {
  PORTAL_ADDRESS,
  STANDARD_TOKEN_IMPL,
  TAX_TOKEN_V3_IMPL,
  QUOTE_TOKEN_CANDIDATES,
  ZERO_ADDRESS,
} from "../lib/contracts/constants";
import { buildLaunchPlan, vanityTargetFor, DAY, type TaxConfig } from "../lib/launch/params";
import { findVanitySalt } from "../lib/launch/salt";

const RPC = process.env.RPC_URL || "https://bsc-dataseed.bnbchain.org";
const client = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 30_000 }) });
// Arbitrary address used only as `from` in eth_call. It never signs anything.
const SIM_ACCOUNT = getAddress("0x000000000000000000000000000000000000c0de");

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed++;
};

function describeRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r) return `revert ${r.data?.errorName ?? r.reason ?? "(no reason)"} ${r.data?.args ? JSON.stringify(r.data.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`;
    return err.shortMessage;
  }
  return String(err);
}

function randomCid(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  return "bafkrei" + Array.from(randomBytes(52), (b) => alphabet[b % 32]).join("");
}

async function simulateLaunch(isTax: boolean) {
  const { tokenImpl, suffix } = vanityTargetFor(isTax);
  const t0 = Date.now();
  const found = findVanitySalt(tokenImpl, suffix, randomBytes(32));
  console.log(`      salt found in ${found.iterations} iterations (${Date.now() - t0} ms) → ${found.address}`);
  const tax: TaxConfig | null = isTax
    ? { buyBps: 100, sellBps: 100, durationSeconds: 365n * DAY, antiFarmerSeconds: 3600n, marketBps: 10_000, deflationBps: 0, lpBps: 0 }
    : null;
  const plan = buildLaunchPlan({
    name: "mapin Simulation",
    symbol: "CMSIM",
    metaCid: randomCid(),
    salt: found.salt,
    quoteToken: ZERO_ADDRESS,
    initialBuy: 0n,
    creator: SIM_ACCOUNT,
    tax,
  });

  // 1. calldata encode/decode round-trip with viem
  const data = encodeFunctionData({ abi: portalAbi, functionName: "newTokenV6", args: [plan.args] });
  const decoded = decodeFunctionData({ abi: portalAbi, data });
  const back = decoded.args?.[0] as typeof plan.args;
  check(decoded.functionName === "newTokenV6" && back.salt === plan.args.salt && back.tokenVersion === plan.args.tokenVersion,
    `${isTax ? "tax" : "tax-free"} newTokenV6 calldata encodes/decodes (${(data.length - 2) / 2} bytes, selector ${data.slice(0, 10)})`);

  // 2. eth_call simulation — nothing is broadcast
  try {
    const { result } = await client.simulateContract({
      account: SIM_ACCOUNT,
      address: PORTAL_ADDRESS,
      abi: portalAbi,
      functionName: "newTokenV6",
      args: [plan.args],
      value: plan.value,
    });
    check(result.toLowerCase() === found.address.toLowerCase(), `${isTax ? "tax" : "tax-free"} launch simulation succeeds → token ${result}`);
  } catch (err) {
    console.log(`INFO  ${isTax ? "tax" : "tax-free"} launch simulation reverted: ${describeRevert(err)}`);
    console.log(`      (the app shows this decoded reason to the user and never opens the wallet)`);
  }
}

async function main() {
  console.log(`RPC: ${RPC.replace(/\/\/([^/]*@)?([^/]+).*/, "//$2/…")}\n`);
  const chainId = await client.getChainId();
  check(chainId === 56, `connected to BNB Smart Chain (chainId ${chainId})`);

  for (const [label, addr] of [["Portal", PORTAL_ADDRESS], ["standard token impl", STANDARD_TOKEN_IMPL], ["tax token V3 impl", TAX_TOKEN_V3_IMPL]] as const) {
    const code = await client.getCode({ address: addr });
    check(Boolean(code && code !== "0x"), `${label} ${addr} has bytecode (${code ? (code.length - 2) / 2 : 0} bytes)`);
  }

  try {
    const version = await client.readContract({ address: PORTAL_ADDRESS, abi: portalAbi, functionName: "version" });
    console.log(`INFO  Portal version(): ${version}`);
  } catch (err) {
    console.log(`INFO  version() unavailable: ${describeRevert(err)}`);
  }
  try {
    const [buy, sell] = await client.readContract({ address: PORTAL_ADDRESS, abi: portalAbi, functionName: "getFeeRate" });
    console.log(`INFO  protocol fee: buy ${buy} bps, sell ${sell} bps`);
  } catch (err) {
    console.log(`INFO  getFeeRate() unavailable: ${describeRevert(err)}`);
  }
  for (const q of QUOTE_TOKEN_CANDIDATES) {
    try {
      const cfg = await client.readContract({ address: PORTAL_ADDRESS, abi: portalAbi, functionName: "getQuoteTokenConfiguration", args: [q] });
      console.log(`INFO  pair asset ${q}: enabled=${cfg.enabled} defaultCurve=${cfg.defaultCurve} nativeSwap=${cfg.nativeToQuoteSwapType}`);
    } catch (err) {
      console.log(`INFO  pair asset ${q}: ${describeRevert(err)}`);
    }
  }

  console.log("\nLaunch simulations (eth_call only):");
  await simulateLaunch(false);
  await simulateLaunch(true);

  const token = process.env.CHECK_TOKEN;
  if (token) {
    console.log(`\nTrading checks for ${token}:`);
    const t = getAddress(token);
    const state = await client.readContract({ address: PORTAL_ADDRESS, abi: portalAbi, functionName: "getTokenV8Safe", args: [t] });
    console.log(`INFO  status=${state.status} price=${state.price} progress=${state.progress} pool=${state.pool} quote=${state.quoteTokenAddress}`);
    if (state.status === 1 && state.quoteTokenAddress === ZERO_ADDRESS) {
      const amountIn = parseEther("0.01");
      const { result: quoted } = await client.simulateContract({
        address: PORTAL_ADDRESS, abi: portalAbi, functionName: "quoteExactInput",
        args: [{ inputToken: ZERO_ADDRESS, outputToken: t, inputAmount: amountIn }],
      });
      check(quoted > 0n, `quoteExactInput 0.01 BNB → ${quoted} tokens`);
      const { result: out } = await client.simulateContract({
        account: SIM_ACCOUNT, address: PORTAL_ADDRESS, abi: portalAbi, functionName: "swapExactInput",
        args: [{ inputToken: ZERO_ADDRESS, outputToken: t, inputAmount: amountIn, minOutputAmount: (quoted * 99n) / 100n, permitData: "0x" }],
        value: amountIn,
        stateOverride: [{ address: SIM_ACCOUNT, balance: parseEther("1") }],
      });
      check(out >= (quoted * 99n) / 100n, `swapExactInput buy simulation → ${out} tokens (not broadcast)`);
    }
  }

  console.log(failed ? `\n${failed} check(s) failed` : "\nAll contract checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
