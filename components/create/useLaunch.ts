"use client";

import { useCallback, useRef, useState } from "react";
import { useConfig, useConnection } from "wagmi";
import { getPublicClient, getWalletClient } from "wagmi/actions";
import { useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { createWalletClient, custom, encodeFunctionData } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { robinhoodChain } from "@/lib/chain/robinhood";
import { api, ApiClientError } from "@/lib/client/api";
import { decodeError } from "@/lib/errors/decode";
import { ponsCurveAbi, ponsFactoryAbi, ponsLaunchRouterAbi } from "@/lib/contracts/pons-abi";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/contracts/constants";
import { OWNER_ESCROW_ADDRESS, OWNER_FEE_BPS } from "@/lib/config/public";
import { buildLaunchPlan, randomSalt, type LaunchPlan } from "@/lib/launch/params";
import { readLaunchTerms, readLaunchedToken } from "@/lib/market/onchain";
import { formatAmount } from "@/lib/validation/normalize";

export const LAUNCH_STEPS = [
  { key: "metadata", label: "Preparing metadata..." },
  { key: "prepare", label: "Preparing transaction..." },
  { key: "wallet", label: "Waiting for wallet..." },
  { key: "submitted", label: "Transaction submitted..." },
  { key: "confirming", label: "Confirming..." },
  { key: "buy", label: "Initial buy (if any)..." },
  { key: "done", label: "Market launched." },
] as const;
export type LaunchStepKey = (typeof LAUNCH_STEPS)[number]["key"];

export interface LaunchInput {
  businessId: string;
  businessName: string;
  description: string;
  tokenName: string;
  symbol: string;
  logo: File;
  twitter: string;
  telegram: string;
  quote: { address: Address; symbol: string; decimals: number; isNative: boolean };
  initialBuy: bigint;
}

export interface LaunchResult {
  tokenAddress: Address;
  txHash: Hex;
  marketPath: string;
  /** set when the market launched but the separate initial buy (ERC-20 pairs) did not complete */
  buyWarning?: string;
  buyTxHash?: Hex;
}

export interface PendingLaunch {
  intentId: string;
  txHash: Hex;
  businessName: string;
  at: number;
}

type Signer = Awaited<ReturnType<typeof getWalletClient>>;
type MetaResult = { metaCid: string; imageCid: string; logoUrl: string; website: string };

const PENDING_KEY = "mapin:pending-launch";
const MAX_GAS = 30_000_000n;
const clampGas = (est: bigint) => {
  const g = (est * 13n) / 10n;
  return g > MAX_GAS ? MAX_GAS : g;
};

export function readPendingLaunch(): PendingLaunch | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingLaunch) : null;
  } catch {
    return null;
  }
}
function writePending(p: PendingLaunch | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable: resume simply won't be offered; the indexer still recovers the market */
  }
}

/** calldata for a launch plan (factory.launchToken or router.launchAndBuy). */
function launchCalldata(plan: LaunchPlan): Hex {
  return plan.route === "factory"
    ? encodeFunctionData({ abi: ponsFactoryAbi, functionName: "launchToken", args: plan.args })
    : encodeFunctionData({ abi: ponsLaunchRouterAbi, functionName: "launchAndBuy", args: plan.args });
}

async function simulateLaunch(pc: PublicClient, account: Address, plan: LaunchPlan): Promise<Address> {
  if (plan.route === "factory") {
    const sim = await pc.simulateContract({ account, address: plan.to, abi: ponsFactoryAbi, functionName: "launchToken", args: plan.args, value: plan.value });
    return sim.result[0];
  }
  const sim = await pc.simulateContract({ account, address: plan.to, abi: ponsLaunchRouterAbi, functionName: "launchAndBuy", args: plan.args, value: plan.value });
  return sim.result[0];
}

export function useLaunch() {
  const { address, chainId } = useConnection();
  // Use the SAME wagmi config instance the provider uses (the imported one can be a different, unconnected copy).
  const config = useConfig();
  const { wallets } = useWallets();
  const qc = useQueryClient();
  const [step, setStep] = useState<LaunchStepKey | null>(null);
  const [error, setError] = useState<{ step: LaunchStepKey | null; message: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const running = useRef(false);
  const metaCache = useRef<{ key: string; value: MetaResult } | null>(null);

  // Get a signer. Try wagmi first; if its connector dropped (common on mobile), fall back to the Privy wallet directly.
  const getSigner = useCallback(async (): Promise<Signer> => {
    try {
      return await getWalletClient(config, { chainId: CHAIN_ID });
    } catch (err) {
      const w =
        wallets.find((x) => address && x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!w) throw new Error("Wallet disconnected. Reconnect your wallet and try again.");
      try {
        await w.switchChain(CHAIN_ID);
      } catch {
        /* wallet may already be on Robinhood Chain or not support switching; the tx still targets robinhoodChain */
      }
      const provider = await w.getEthereumProvider();
      return createWalletClient({
        account: w.address as Address,
        chain: robinhoodChain,
        transport: custom(provider),
      }) as unknown as Signer;
    }
  }, [config, wallets, address]);

  const confirmOnServer = useCallback(async (intentId: string, hash: Hex): Promise<LaunchResult> => {
    const r = await api<{ tokenAddress: Address; txHash: Hex; marketPath: string }>("/api/markets/confirm", {
      method: "POST",
      json: { intentId, txHash: hash },
    });
    writePending(null);
    await qc.invalidateQueries({ queryKey: ["markets"] });
    return { tokenAddress: r.tokenAddress, txHash: r.txHash, marketPath: r.marketPath };
  }, [qc]);

  const launch = useCallback(async (input: LaunchInput) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setResult(null);
    setTxHash(null);
    setDetail(null);
    let current: LaunchStepKey = "metadata";
    const go = (s: LaunchStepKey, d: string | null = null) => {
      current = s;
      setStep(s);
      setDetail(d);
    };
    try {
      if (!address) throw new Error("Connect your wallet first.");
      if (chainId !== CHAIN_ID) throw new Error(`Switch your wallet to ${CHAIN_NAME} first.`);
      const publicClient = getPublicClient(config, { chainId: CHAIN_ID }) as unknown as PublicClient;

      // 1. logo + metadata (re-used if nothing that goes into it changed)
      go("metadata");
      const metaKey = [input.businessId, input.description, input.twitter, input.telegram, input.logo.name, input.logo.size, input.logo.lastModified].join("|");
      let meta = metaCache.current?.key === metaKey ? metaCache.current.value : null;
      if (!meta) {
        const fd = new FormData();
        fd.set("businessId", input.businessId);
        fd.set("description", input.description);
        fd.set("twitter", input.twitter);
        fd.set("telegram", input.telegram);
        fd.set("image", input.logo);
        meta = await api<MetaResult>("/api/metadata", { method: "POST", body: fd });
        metaCache.current = { key: metaKey, value: meta };
      }

      // 2. live launch terms → plan → balance check → simulation → server reservation
      go("prepare", "Reading launch terms from the chain…");
      const terms = await readLaunchTerms(publicClient, input.quote.address);
      if (!terms.launchEnabled) throw new Error("Launching is currently paused by the launch protocol. Try again later.");
      if (!terms.configEnabled) throw new Error("The launch configuration is disabled on-chain. Try again later.");
      const plan = buildLaunchPlan({
        name: input.tokenName,
        symbol: input.symbol,
        logoUrl: meta.logoUrl,
        description: input.description,
        website: meta.website,
        twitter: input.twitter,
        telegram: input.telegram,
        creator: address,
        feeRecipient: OWNER_ESCROW_ADDRESS as Address,
        creatorFeeBps: OWNER_FEE_BPS,
        initialBuy: input.initialBuy,
        salt: randomSalt(),
        terms,
      });

      setDetail(`Simulating launch on ${CHAIN_NAME}…`);
      let predicted: Address;
      try {
        predicted = await simulateLaunch(publicClient, address, plan);
      } catch (err) {
        throw new Error(`Launch simulation failed — nothing was sent. ${decodeError(err, "Launch simulation").message}`);
      }
      const data = launchCalldata(plan);
      const gas = clampGas(await publicClient.estimateGas({ account: address, to: plan.to, data, value: plan.value }));
      const [gasPrice, eth] = await Promise.all([publicClient.getGasPrice(), publicClient.getBalance({ address })]);
      const needed = plan.value + gas * gasPrice;
      if (eth < needed) {
        throw new Error(`Insufficient ETH: need about ${formatAmount(needed, 18, 6)} ETH (launch fee${plan.route === "router" ? " + initial buy" : ""} + gas), you have ${formatAmount(eth, 18, 6)} ETH.`);
      }
      if (plan.followUpBuy) {
        const bal = await publicClient.readContract({ address: input.quote.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
        if (bal < plan.followUpBuy.amount) {
          throw new Error(`Insufficient ${input.quote.symbol} for the initial buy: need ${formatAmount(plan.followUpBuy.amount, input.quote.decimals, 6)}, you have ${formatAmount(bal, input.quote.decimals, 6)}. Lower the initial buy or set it to 0.`);
        }
      }
      setDetail(`Token address ${predicted}`);

      const prep = await api<{ intentId: string }>("/api/markets/prepare", {
        method: "POST",
        json: {
          businessId: input.businessId,
          description: input.description,
          tokenName: plan.params.name,
          symbol: plan.params.symbol,
          metaCid: meta.metaCid,
          imageCid: meta.imageCid,
          logoUrl: meta.logoUrl,
          salt: plan.params.salt,
          predictedToken: predicted,
          creatorFeeBps: OWNER_FEE_BPS,
          feeRecipient: OWNER_ESCROW_ADDRESS,
          quoteToken: input.quote.address,
          config: {
            quoteSymbol: input.quote.symbol,
            initialBuy: input.initialBuy.toString(),
            launchFee: terms.launchFee.toString(),
            route: plan.route,
          },
        },
      });

      // 3. wallet signature
      go("wallet", "Confirm the launch in your wallet");
      const wc = await getSigner();
      let hash: Hex;
      try {
        hash = await wc.sendTransaction({ account: address, to: plan.to, data, value: plan.value, gas, chain: robinhoodChain });
      } catch (err) {
        const d = decodeError(err, "Launch");
        throw new Error(d.kind === "rejected" ? "Launch rejected in your wallet." : d.message);
      }
      setTxHash(hash);
      writePending({ intentId: prep.intentId, txHash: hash, businessName: input.businessName, at: Date.now() });

      // 5-6. mined + verified server-side
      go("submitted", hash);
      go("confirming", `Waiting for ${CHAIN_NAME} confirmation…`);
      let finalHash: Hex = hash;
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 180_000,
        onReplaced: (r) => {
          if (r.reason === "cancelled") return;
          finalHash = r.transaction.hash;
          setTxHash(r.transaction.hash);
          writePending({ intentId: prep.intentId, txHash: r.transaction.hash, businessName: input.businessName, at: Date.now() });
          setDetail("Transaction was sped up in your wallet — following the replacement…");
        },
      });
      if (receipt.status !== "success") {
        writePending(null);
        throw new Error("Launch transaction reverted on-chain. No market was created.");
      }
      if (receipt.transactionHash !== finalHash) finalHash = receipt.transactionHash;
      setDetail("Detecting token contract…");
      const done: LaunchResult = await confirmOnServer(prep.intentId, finalHash);

      // 7. ERC-20 pairs: the initial buy is a normal curve buy right after the launch.
      if (plan.followUpBuy) {
        go("buy", `Approve ${input.quote.symbol} for the initial buy in your wallet`);
        try {
          const fb = plan.followUpBuy;
          const lt = await readLaunchedToken(publicClient, done.tokenAddress);
          const curve = lt.curve;
          const allowance = await publicClient.readContract({ address: input.quote.address, abi: erc20Abi, functionName: "allowance", args: [address, curve] });
          const wc2 = await getSigner();
          if (allowance < fb.amount) {
            const ah = await wc2.writeContract({ address: input.quote.address, abi: erc20Abi, functionName: "approve", args: [curve, fb.amount], account: address, chain: robinhoodChain });
            setDetail("Waiting for approval confirmation…");
            const ar = await publicClient.waitForTransactionReceipt({ hash: ah, timeout: 180_000 });
            if (ar.status !== "success") throw new Error("Approval transaction reverted.");
          }
          await publicClient.simulateContract({ account: address, address: curve, abi: ponsCurveAbi, functionName: "buy", args: [fb.amount, fb.minTokensOut, address] });
          setDetail("Confirm the initial buy in your wallet");
          const bh = await wc2.writeContract({ address: curve, abi: ponsCurveAbi, functionName: "buy", args: [fb.amount, fb.minTokensOut, address], account: address, chain: robinhoodChain });
          done.buyTxHash = bh;
          setDetail("Waiting for the initial buy to confirm…");
          const br = await publicClient.waitForTransactionReceipt({ hash: bh, timeout: 180_000 });
          if (br.status !== "success") throw new Error("The initial buy reverted on-chain.");
        } catch (err) {
          const d = err instanceof Error && !("walk" in err) ? err.message : decodeError(err, "Initial buy").message;
          done.buyWarning = `The market is live, but the initial buy did not complete: ${d} You can buy from the market page.`;
        }
      }
      go("done");
      setResult(done);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : (err as { name?: string })?.name === "TransactionReplacementError" || /replaced|cancelled/i.test(String((err as Error)?.message))
            ? "The transaction was cancelled or replaced in your wallet. No market was created."
            : err instanceof Error && !("walk" in err)
              ? err.message
              : decodeError(err, "Launch").message;
      setError({ step: current, message });
    } finally {
      running.current = false;
    }
  }, [address, chainId, confirmOnServer, config, getSigner]);

  const resume = useCallback(async (p: PendingLaunch) => {
    setError(null);
    setStep("confirming");
    setTxHash(p.txHash);
    try {
      const done = await confirmOnServer(p.intentId, p.txHash);
      setStep("done");
      setResult(done);
    } catch (err) {
      setError({ step: "confirming", message: err instanceof Error ? err.message : String(err) });
    }
  }, [confirmOnServer]);

  const reset = useCallback(() => {
    setStep(null);
    setError(null);
    setDetail(null);
    setResult(null);
    setTxHash(null);
  }, []);

  return { launch, resume, reset, step, error, detail, result, txHash };
}

export { writePending as clearPendingLaunch };
