"use client";

import { useConfig, useConnection, usePublicClient } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { createWalletClient, custom, decodeEventLog, encodeFunctionData, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { robinhoodChain } from "@/lib/chain/robinhood";
import { CHAIN_ID } from "@/lib/contracts/constants";
import { KIND_COUNTRY, KIND_CURRENCY, MAPIN_LAUNCHPAD, launchTokenAbi, mapinAbi } from "@/lib/contracts/mapin-abi";
import { decodeError } from "@/lib/errors/decode";

export interface MapinToken {
  address: Address;
  key: string; // "DZD" (currency coin) or "DZ" (country token)
  kind: 1 | 2;
  name: string;
  symbol: string;
  meta: string;
  quote: Address;
  creator: Address;
  createdAt: number; // unix seconds
  creatorFeeBps: number;
  pair: Address; // Uniswap V2 pair token/quote, created at launch
  migrated: boolean; // liquidity is in the Uniswap pair
  priceEth: bigint; // wei per 1e18 tokens
  progressBps: number;
  realQuote: bigint;
  graduated: boolean;
}

export interface MapinState {
  currencies: Map<string, MapinToken>; // by currency code
  countries: MapinToken[]; // every country token, oldest first
  byPlace: Map<string, MapinToken[]>; // place id -> its tokens, newest first
  byAddress: Map<string, MapinToken>; // lower-case address -> token
}

const meta = new Map<string, { name: string; symbol: string; meta: string }>();
const fromB32 = (h: Hex) => {
  const bytes = h.slice(2).match(/../g) ?? [];
  return bytes.map((b) => parseInt(b, 16)).filter((n) => n !== 0).map((n) => String.fromCharCode(n)).join("");
};

const PAGE = 250n;

async function readKind(pc: PublicClient, kind: 1 | 2): Promise<MapinToken[]> {
  const out: MapinToken[] = [];
  for (let offset = 0n; ; offset += PAGE) {
    const list = await pc.readContract({
      address: MAPIN_LAUNCHPAD as Address, abi: mapinAbi, functionName: "getTokens", args: [kind, offset, PAGE],
    });
    await Promise.all(list.map(async (v) => {
      if (meta.has(v.token)) return;
      const [name, symbol, m] = await Promise.all([
        pc.readContract({ address: v.token, abi: launchTokenAbi, functionName: "name" }),
        pc.readContract({ address: v.token, abi: launchTokenAbi, functionName: "symbol" }),
        pc.readContract({ address: v.token, abi: launchTokenAbi, functionName: "metadataURI" }).catch(() => ""),
      ]);
      meta.set(v.token, { name, symbol, meta: m });
    }));
    for (const v of list) {
      out.push({
        address: v.token, key: fromB32(v.key), kind, ...meta.get(v.token)!,
        quote: v.quote, creator: v.creator, createdAt: Number(v.createdAt), creatorFeeBps: Number(v.creatorFeeBps), pair: v.pair, migrated: v.migrated,
        priceEth: v.priceEth, progressBps: Number(v.progressBps), realQuote: v.realQuote, graduated: v.graduated,
      });
    }
    if (BigInt(list.length) < PAGE) break;
  }
  return out;
}

/** Every launched currency coin and country token, refreshed every 15 s. */
export function useMapinState() {
  const pc = usePublicClient({ chainId: CHAIN_ID }) as unknown as PublicClient | undefined;
  return useQuery({
    queryKey: ["mapin-state"],
    enabled: Boolean(pc && MAPIN_LAUNCHPAD),
    refetchInterval: 15_000,
    queryFn: async (): Promise<MapinState> => {
      const [cur, cty] = await Promise.all([readKind(pc!, KIND_CURRENCY), readKind(pc!, KIND_COUNTRY)]);
      const byPlace = new Map<string, MapinToken[]>();
      for (const t of cty) byPlace.set(t.key, [t, ...(byPlace.get(t.key) ?? [])]);
      const byAddress = new Map<string, MapinToken>();
      for (const t of [...cur, ...cty]) byAddress.set(t.address.toLowerCase(), t);
      return { currencies: new Map(cur.map((t) => [t.key, t])), countries: cty, byPlace, byAddress };
    },
  });
}

/** ETH/USD spot for local-currency display (Coinbase public API). Display only, never used on-chain. */
export function useEthUsd() {
  return useQuery({
    queryKey: ["eth-usd"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
      const j = (await r.json()) as { data?: { amount?: string } };
      const n = Number(j.data?.amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
  });
}

/** Wallet + transaction helper shared by launch and trade forms. */
export function useMapinTx() {
  const { address, chainId } = useConnection();
  const config = useConfig();
  const { wallets } = useWallets();
  const pc = usePublicClient({ chainId: CHAIN_ID }) as unknown as PublicClient | undefined;

  async function signer() {
    try {
      return await getWalletClient(config, { chainId: CHAIN_ID });
    } catch {
      const w = wallets.find((x) => address && x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!w) throw new Error("Wallet disconnected. Reconnect your wallet and try again.");
      try { await w.switchChain(CHAIN_ID); } catch { /* already on chain */ }
      const provider = await w.getEthereumProvider();
      return createWalletClient({ account: w.address as Address, chain: robinhoodChain, transport: custom(provider) });
    }
  }

  /** Simulate, send, wait. Returns the receipt. */
  async function send(to: Address, abi: Abi, functionName: string, args: readonly unknown[], value = 0n, label = "Transaction") {
    if (!address || !pc) throw new Error("Connect your wallet first.");
    try {
      await pc.simulateContract({ account: address, address: to, abi, functionName, args, value } as never);
    } catch (err) {
      throw new Error(decodeError(err, label).message);
    }
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const wc = await signer();
    let hash: Hex;
    try {
      const gas = await pc.estimateGas({ account: address, to, data, value });
      hash = await wc.sendTransaction({ account: address, to, data, value, gas: (gas * 13n) / 10n, chain: robinhoodChain } as never);
    } catch (err) {
      const d = decodeError(err, label);
      throw new Error(d.kind === "rejected" ? `${label} was rejected in your wallet.` : d.message);
    }
    const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${label} failed on-chain. Only gas was spent.`);
    return receipt;
  }

  async function ensureAllowance(token: Address, amount: bigint, symbol: string) {
    if (!address || !pc) throw new Error("Connect your wallet first.");
    const cur = await pc.readContract({ address: token, abi: launchTokenAbi, functionName: "allowance", args: [address, MAPIN_LAUNCHPAD as Address] });
    if (cur >= amount) return;
    await send(token, launchTokenAbi as Abi, "approve", [MAPIN_LAUNCHPAD, amount], 0n, `Approve ${symbol}`);
  }

  function launchedToken(receipt: { logs: { data: Hex; topics: readonly Hex[] }[] }, event: "CurrencyLaunched" | "CountryLaunched" = "CountryLaunched"): Address | null {
    let found: Address | null = null;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: mapinAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === event) found = ev.args.token;
      } catch { /* other events */ }
    }
    return found;
  }

  return { address, onChain: chainId === CHAIN_ID, pc, send, ensureAllowance, launchedToken };
}
