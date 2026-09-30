// Contract integration check against Robinhood Chain MAINNET — read-only.
//
// * confirms the chain id and that the Pons factory / launch router / Uniswap v4 contracts have bytecode
// * reads the live launch terms (fee, enabled flag, config 0 economics, economics digest)
// * checks the owner-rotatable launch router and meme hook still equal the pinned addresses
// * simulates factory.launchToken and router.launchAndBuy with eth_call (balance given to a
//   throwaway address via a state override) and prints the predicted token + curve
// * optionally (CHECK_TOKEN=0x…) reads a launched token's market state and quotes a 0.01 ETH buy
//
// There is NO wallet client and NO private key in this script: it cannot broadcast anything.
// Usage:  npm run test:contracts      (uses ROBINHOOD_RPC_URL from .env.local, else the official endpoint)

import "./load-env";
import { BaseError, ContractFunctionRevertedError, createPublicClient, getAddress, http, parseEther, type PublicClient } from "viem";
import { robinhoodChain } from "../lib/chain/robinhood";
import { ponsFactoryAbi, ponsLaunchRouterAbi } from "../lib/contracts/pons-abi";
import {
  CHAIN_ID, PONS_FACTORY, PONS_LAUNCH_ROUTER, PONS_MEME_HOOK, UNIVERSAL_ROUTER, V4_POOL_MANAGER, V4_QUOTER, V4_STATE_VIEW,
} from "../lib/contracts/constants";
import { buildLaunchPlan, randomSalt } from "../lib/launch/params";
import { curveStateOf, readLaunchTerms, readLensState, quoteDex, verifyDexPool } from "../lib/market/onchain";
import { quoteBuy } from "../lib/market/curve-math";

const RPC = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC, { timeout: 30_000 }) }) as PublicClient;
// Arbitrary address used only as `from` in eth_call. It never signs anything.
const SIM_ACCOUNT = getAddress("0x000000000000000000000000000000000000c0de");

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}
function revertText(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return err.shortMessage;
  }
  return String(err);
}

async function main() {
  console.log(`RPC ${RPC}`);
  const chainId = await client.getChainId();
  check(chainId === CHAIN_ID, `connected to Robinhood Chain (chainId ${chainId})`);

  for (const [label, addr] of [
    ["Pons factory", PONS_FACTORY], ["Pons launch router", PONS_LAUNCH_ROUTER], ["v4 PoolManager", V4_POOL_MANAGER],
    ["v4 Quoter", V4_QUOTER], ["v4 StateView", V4_STATE_VIEW], ["Universal Router", UNIVERSAL_ROUTER],
  ] as const) {
    const code = await client.getCode({ address: addr });
    check(Boolean(code && code !== "0x"), `${label} ${addr} has bytecode`);
  }

  const terms = await readLaunchTerms(client);
  console.log(`INFO  launchFee ${terms.launchFee} wei · launchEnabled ${terms.launchEnabled} · maxCreatorTaxBps ${terms.maxCreatorTaxBps}`);
  console.log(`INFO  config 0: supply ${terms.supply} · curveFeeBps ${terms.curveFeeBps} · phantom ${terms.phantomQuote} · threshold ${terms.graduationThreshold} · enabled ${terms.configEnabled}`);
  check(terms.launchEnabled && terms.configEnabled, "public launching is enabled");
  check(/^0x[0-9a-f]{64}$/i.test(terms.expectedEconomics) && BigInt(terms.expectedEconomics) !== 0n, `economics digest ${terms.expectedEconomics}`);
  check(terms.launchForwarder.toLowerCase() === PONS_LAUNCH_ROUTER.toLowerCase(), `launchForwarder() is the pinned router (${terms.launchForwarder})`);
  const hook = await client.readContract({ address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "memeHook" });
  check(hook.toLowerCase() === PONS_MEME_HOOK.toLowerCase(), `memeHook() is the pinned hook (${hook})`);

  const common = {
    name: "mapin Check", symbol: "MAPCHK", logoUrl: "https://example.com/mapin-logo.png",
    description: "Read-only simulation", website: "https://example.com/b/check", twitter: "", telegram: "",
    creator: SIM_ACCOUNT, feeRecipient: SIM_ACCOUNT, creatorFeeBps: 70, terms,
  };
  const stateOverride = [{ address: SIM_ACCOUNT, balance: parseEther("100") }];
  for (const initialBuy of [0n, parseEther("0.01")]) {
    const plan = buildLaunchPlan({ ...common, initialBuy, salt: randomSalt() });
    try {
      const sim = plan.route === "factory"
        ? await client.simulateContract({ account: SIM_ACCOUNT, address: plan.to, abi: ponsFactoryAbi, functionName: "launchToken", args: plan.args, value: plan.value, stateOverride })
        : await client.simulateContract({ account: SIM_ACCOUNT, address: plan.to, abi: ponsLaunchRouterAbi, functionName: "launchAndBuy", args: plan.args, value: plan.value, stateOverride });
      check(true, `${plan.route} launch simulates → token ${sim.result[0]} curve ${sim.result[1]}`);
    } catch (err) {
      check(false, `${plan.route} launch simulation reverted: ${revertText(err)}`);
    }
  }

  const t = process.env.CHECK_TOKEN;
  if (t) {
    const token = getAddress(t);
    const lens = await readLensState(client, token);
    console.log(`INFO  ${token}: status ${lens.status} · price ${lens.price} · progress ${lens.progress} · curve ${lens.curve}`);
    if (lens.pool === "") {
      const q = quoteBuy(curveStateOf(lens), parseEther("0.01"));
      check(q.tokensOut > 0n, `curve quote 0.01 ETH → ${q.tokensOut} tokens`);
    } else {
      const v = await verifyDexPool(client, token);
      check(Boolean(v), `v4 pool ${lens.pool} verified`);
      if (v) {
        const out = await quoteDex(client, { key: v.key, currencyIn: v.key.currency0, amountIn: parseEther("0.01") });
        check(out > 0n, `v4 quote 0.01 ETH → ${out} tokens`);
      }
    }
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
