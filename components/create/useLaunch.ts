"use client";

import { useCallback, useRef, useState } from "react";
import { useConfig, useConnection } from "wagmi";
import { getPublicClient, getWalletClient } from "wagmi/actions";
import { useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { createWalletClient, custom } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { bscChain } from "@/lib/chain/bsc";
import { api, ApiClientError } from "@/lib/client/api";
import { decodeError } from "@/lib/errors/decode";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { BSC_CHAIN_ID, PORTAL_ADDRESS } from "@/lib/contracts/constants";
import { buildLaunchPlan, vanityTargetFor, type TaxConfig } from "@/lib/launch/params";
import { findVanitySaltAsync } from "@/lib/launch/salt";
import { formatAmount } from "@/lib/validation/normalize";
import type { SaltWorkerResponse } from "@/workers/salt-worker";

export const LAUNCH_STEPS = [
  { key: "metadata", label: "Preparing metadata..." },
  { key: "salt", label: "Generating token address..." },
  { key: "prepare", label: "Preparing transaction..." },
  { key: "wallet", label: "Waiting for wallet..." },
  { key: "submitted", label: "Transaction submitted..." },
  { key: "confirming", label: "Confirming..." },
  { key: "done", label: "Market launched." },
] as const;
export type LaunchStepKey = (typeof LAUNCH_STEPS)[number]["key"];

export interface LaunchInput {
  placeId: string;
  placeName: string;
  description: string;
  tokenName: string;
  symbol: string;
  logo: File;
  twitter: string;
  telegram: string;
  quote: { address: Address; symbol: string; decimals: number; isNative: boolean };
  initialBuy: bigint;
  tax: TaxConfig | null;
}

export interface LaunchResult {
  tokenAddress: Address;
  txHash: Hex;
  marketPath: string;
}

export interface PendingLaunch {
  intentId: string;
  txHash: Hex;
  placeName: string;
  at: number;
}

type Signer = Awaited<ReturnType<typeof getWalletClient>>;

const PENDING_KEY = "mapin:pending-launch";
const MAX_GAS = 15_000_000n;
const clampGas = (est: bigint) => {
  const g = (est * 12n) / 10n;
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

function runSaltSearch(tokenImpl: Address, suffix: string, onProgress: (n: number) => void): { promise: Promise<{ salt: Hex; address: Address }>; cancel: () => void } {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("../../workers/salt-worker.ts", import.meta.url), { type: "module" });
  } catch (err) {
    console.warn("[mapin] Web Worker unavailable, searching on the main thread in small chunks", err);
  }
  if (!worker) {
    const abort = new AbortController();
    const promise = findVanitySaltAsync(tokenImpl, suffix, crypto.getRandomValues(new Uint8Array(32)), { onProgress, signal: abort.signal })
      .then((r) => ({ salt: r.salt, address: r.address }));
    return { promise, cancel: () => abort.abort() };
  }
  const w = worker;
  let settle: ((e?: Error) => void) | null = null;
  const promise = new Promise<{ salt: Hex; address: Address }>((resolve, reject) => {
    settle = (e) => reject(e ?? new Error("cancelled"));
    w.onmessage = (e: MessageEvent<SaltWorkerResponse>) => {
      const m = e.data;
      if (m.type === "progress") onProgress(m.iterations);
      else if (m.type === "done") {
        w.terminate();
        resolve({ salt: m.salt, address: m.address });
      } else {
        w.terminate();
        reject(new Error(`Token address generation failed: ${m.message}`));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(`Token address generation failed: ${e.message || "worker error"}`));
    };
    w.postMessage({ tokenImpl, suffix });
  });
  return {
    promise,
    cancel: () => {
      w.terminate();
      settle?.(new Error("Launch cancelled."));
    },
  };
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
  const cancelSalt = useRef<(() => void) | null>(null);
  const metaCache = useRef<{ key: string; cid: string } | null>(null);

  // Get a signer. Try wagmi first; if its connector dropped (common on mobile), fall back to the Privy wallet directly.
  const getSigner = useCallback(async (): Promise<Signer> => {
    try {
      return await getWalletClient(config, { chainId: BSC_CHAIN_ID });
    } catch (err) {
      const w =
        wallets.find((x) => address && x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!w) throw new Error("Wallet disconnected. Reconnect your wallet and try again.");
      try {
        await w.switchChain(BSC_CHAIN_ID);
      } catch {
        /* wallet may already be on BSC or not support switching; the tx still targets bscChain */
      }
      const provider = await w.getEthereumProvider();
      return createWalletClient({
        account: w.address as Address,
        chain: bscChain,
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
      if (chainId !== BSC_CHAIN_ID) throw new Error("Switch your wallet to BNB Smart Chain first.");
      const publicClient = getPublicClient(config, { chainId: BSC_CHAIN_ID }) as unknown as PublicClient;

      // 1. metadata (re-used if nothing that goes into it changed)
      go("metadata");
      const metaKey = [input.placeId, input.description, input.twitter, input.telegram, input.logo.name, input.logo.size, input.logo.lastModified].join("|");
      let metaCid = metaCache.current?.key === metaKey ? metaCache.current.cid : null;
      if (!metaCid) {
        const fd = new FormData();
        fd.set("placeId", input.placeId);
        fd.set("description", input.description);
        fd.set("twitter", input.twitter);
        fd.set("telegram", input.telegram);
        fd.set("image", input.logo);
        const r = await api<{ metaCid: string }>("/api/metadata", { method: "POST", body: fd });
        metaCid = r.metaCid;
        metaCache.current = { key: metaKey, cid: metaCid };
      }

      // 2. vanity CREATE2 salt in a Web Worker
      go("salt", "0 addresses checked");
      const { tokenImpl, suffix } = vanityTargetFor(input.tax !== null);
      const job = runSaltSearch(tokenImpl, suffix, (n) => setDetail(`${n.toLocaleString()} addresses checked`));
      cancelSalt.current = job.cancel;
      const { salt, address: predicted } = await job.promise;
      cancelSalt.current = null;
      setDetail(`Token address ${predicted}`);

      // 3. server reservation + balance/allowance checks + simulation
      go("prepare");
      const plan = buildLaunchPlan({
        name: input.tokenName,
        symbol: input.symbol,
        metaCid,
        salt,
        quoteToken: input.quote.address,
        initialBuy: input.initialBuy,
        creator: address,
        tax: input.tax,
      });
      const prep = await api<{ intentId: string; predictedToken: Address }>("/api/markets/prepare", {
        method: "POST",
        json: {
          placeId: input.placeId,
          description: input.description,
          tokenName: plan.args.name,
          symbol: plan.args.symbol,
          metaCid,
          salt,
          isTax: plan.isTax,
          quoteToken: input.quote.address,
          config: {
            quoteSymbol: input.quote.symbol,
            initialBuy: input.initialBuy.toString(),
            buyTaxBps: plan.args.buyTaxRate,
            sellTaxBps: plan.args.sellTaxRate,
          },
        },
      });
      if (prep.predictedToken.toLowerCase() !== predicted.toLowerCase()) throw new Error("Server and browser disagree on the token address. Retry.");

      if (plan.erc20Approval > 0n) {
        const bal = await publicClient.readContract({ address: input.quote.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
        if (bal < plan.erc20Approval) {
          throw new Error(`Insufficient ${input.quote.symbol} balance: need ${formatAmount(plan.erc20Approval, input.quote.decimals, 6)}, you have ${formatAmount(bal, input.quote.decimals, 6)}.`);
        }
        const allowance = await publicClient.readContract({ address: input.quote.address, abi: erc20Abi, functionName: "allowance", args: [address, PORTAL_ADDRESS] });
        if (allowance < plan.erc20Approval) {
          setDetail(`Approve ${input.quote.symbol} spending in your wallet`);
          await publicClient.simulateContract({ account: address, address: input.quote.address, abi: erc20Abi, functionName: "approve", args: [PORTAL_ADDRESS, plan.erc20Approval] });
          const wc = await getSigner();
          let approveHash: Hex;
          try {
            approveHash = await wc.writeContract({ address: input.quote.address, abi: erc20Abi, functionName: "approve", args: [PORTAL_ADDRESS, plan.erc20Approval], account: address, chain: bscChain });
          } catch (err) {
            const d = decodeError(err, "Approval");
            throw new Error(d.kind === "rejected" ? "Approval rejected in your wallet." : d.message);
          }
          setDetail("Waiting for approval confirmation…");
          const ar = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 180_000 });
          if (ar.status !== "success") throw new Error("Approval transaction reverted.");
        }
      }

      setDetail("Simulating launch on BNB Chain…");
      let simulatedToken: Address;
      try {
        const sim = await publicClient.simulateContract({
          account: address,
          address: PORTAL_ADDRESS,
          abi: portalAbi,
          functionName: "newTokenV6",
          args: [plan.args],
          value: plan.value,
        });
        simulatedToken = sim.result;
      } catch (err) {
        throw new Error(`Launch simulation failed — nothing was sent. ${decodeError(err, "Launch simulation").message}`);
      }
      if (simulatedToken.toLowerCase() !== predicted.toLowerCase()) throw new Error("Simulated token address does not match. Regenerate and retry.");

      const gasEstimate = await publicClient.estimateContractGas({
        account: address, address: PORTAL_ADDRESS, abi: portalAbi, functionName: "newTokenV6", args: [plan.args], value: plan.value,
      });
      const gas = clampGas(gasEstimate);
      const [gasPrice, bnb] = await Promise.all([publicClient.getGasPrice(), publicClient.getBalance({ address })]);
      const needed = plan.value + gas * gasPrice;
      if (bnb < needed) {
        throw new Error(`Insufficient BNB: need about ${formatAmount(needed, 18, 6)} BNB (amount + gas), you have ${formatAmount(bnb, 18, 6)} BNB.`);
      }

      // 4. wallet signature
      go("wallet", "Confirm the launch in your wallet");
      const wc = await getSigner();
      let hash: Hex;
      try {
        hash = await wc.writeContract({
          address: PORTAL_ADDRESS, abi: portalAbi, functionName: "newTokenV6", args: [plan.args], value: plan.value, gas, account: address, chain: bscChain,
        });
      } catch (err) {
        const d = decodeError(err, "Launch");
        throw new Error(d.kind === "rejected" ? "Launch rejected in your wallet." : d.message);
      }
      setTxHash(hash);
      writePending({ intentId: prep.intentId, txHash: hash, placeName: input.placeName, at: Date.now() });

      // 5-6. mined + verified server-side
      go("submitted", hash);
      go("confirming", "Waiting for BNB Chain confirmation…");
      let finalHash: Hex = hash;
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 180_000,
        onReplaced: (r) => {
          if (r.reason === "cancelled") return;
          finalHash = r.transaction.hash;
          setTxHash(r.transaction.hash);
          writePending({ intentId: prep.intentId, txHash: r.transaction.hash, placeName: input.placeName, at: Date.now() });
          setDetail("Transaction was sped up in your wallet — following the replacement…");
        },
      });
      if (receipt.status !== "success") {
        writePending(null);
        throw new Error("Launch transaction reverted on-chain. No market was created.");
      }
      if (receipt.transactionHash !== finalHash) finalHash = receipt.transactionHash;
      setDetail("Detecting token contract…");
      const done = await confirmOnServer(prep.intentId, finalHash);
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
      cancelSalt.current = null;
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

  const cancel = useCallback(() => cancelSalt.current?.(), []);
  const reset = useCallback(() => {
    setStep(null);
    setError(null);
    setDetail(null);
    setResult(null);
    setTxHash(null);
  }, []);

  return { launch, resume, cancel, reset, step, error, detail, result, txHash };
}

export { writePending as clearPendingLaunch };
