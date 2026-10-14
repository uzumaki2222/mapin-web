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
  key: string; // "DZD" or "DZ"
  kind: 1 | 2;
  name: string;
  symbol: string;
  meta: string;
  priceEth: bigint; // wei per 1e18 tokens
  progressBps: number;
  realQuote: bigint;
  graduated: boolean;
}

export interface MapinState {
  currencies: Map<string, MapinToken>; // by currency code
  countries: Map<string, MapinToken>; // by place id
}

const meta = new Map<string, { name: string; symbol: string; meta: string }>();
const fromB32 = (h: Hex) => {
  const bytes = h.slice(2).match(/../g) ?? [];
  return bytes.map((b) => parseInt(b, 16)).filter((n) => n !== 0).map((n) => String.fromCharCode(n)).join("");
};

async function readKind(pc: PublicClient, kind: 1 | 2): Promise<MapinToken[]> {
  const out: MapinToken[] = [];
  for (let offset = 0n; ; offset += 300n) {
    const [tokens, keys, prices, progress, real, grad] = await pc.readContract({
      address: MAPIN_LAUNCHPAD as Address, abi: mapinAbi, functionName: "getMapState", args: [kind, offset, 300n],
    });
    await Promise.all(tokens.map(async (t) => {
      if (meta.has(t)) return;
      const [name, symbol, m] = await Promise.all([
        pc.readContract({ address: t, abi: launchTokenAbi, functionName: "name" }),
        pc.readContract({ address: t, abi: launchTokenAbi, functionName: "symbol" }),
        pc.readContract({ address: t, abi: launchTokenAbi, functionName: "metadataURI" }).catch(() => ""),
      ]);
      meta.set(t, { name, symbol, meta: m });
    }));
    tokens.forEach((t, i) => {
      const md = meta.get(t)!;
      out.push({ address: t, key: fromB32(keys[i]!), kind, ...md, priceEth: prices[i]!, progressBps: Number(progress[i]), realQuote: real[i]!, graduated: grad[i]! });
    });
    if (tokens.length < 300) break;
  }
  return out;
}

/** Every launched currency and country token, refreshed every 20 s. */
export function useMapinState() {
  const pc = usePublicClient({ chainId: CHAIN_ID }) as unknown as PublicClient | undefined;
  return useQuery({
    queryKey: ["mapin-state"],
    enabled: Boolean(pc && MAPIN_LAUNCHPAD),
    refetchInterval: 20_000,
    queryFn: async (): Promise<MapinState> => {
      const [cur, cty] = await Promise.all([readKind(pc!, KIND_CURRENCY), readKind(pc!, KIND_COUNTRY)]);
      return { currencies: new Map(cur.map((t) => [t.key, t])), countries: new Map(cty.map((t) => [t.key, t])) };
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
      if (!w) throw new Error("Wallet terputus. Hubungkan ulang wallet kamu.");
      try { await w.switchChain(CHAIN_ID); } catch { /* already on chain */ }
      const provider = await w.getEthereumProvider();
      return createWalletClient({ account: w.address as Address, chain: robinhoodChain, transport: custom(provider) });
    }
  }

  /** Simulate, send, wait. Returns the receipt. */
  async function send(to: Address, abi: Abi, functionName: string, args: readonly unknown[], value = 0n, label = "Transaksi") {
    if (!address || !pc) throw new Error("Hubungkan wallet dulu.");
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
      throw new Error(d.kind === "rejected" ? `${label} dibatalkan di wallet.` : d.message);
    }
    const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${label} gagal di chain. Dana kamu tidak terpakai kecuali gas.`);
    return receipt;
  }

  async function ensureAllowance(token: Address, amount: bigint, symbol: string) {
    if (!address || !pc) throw new Error("Hubungkan wallet dulu.");
    const cur = await pc.readContract({ address: token, abi: launchTokenAbi, functionName: "allowance", args: [address, MAPIN_LAUNCHPAD as Address] });
    if (cur >= amount) return;
    await send(token, launchTokenAbi as Abi, "approve", [MAPIN_LAUNCHPAD, amount], 0n, `Izin ${symbol}`);
  }

  function launchedToken(receipt: { logs: { data: Hex; topics: readonly Hex[] }[] }): Address | null {
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: mapinAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "CurrencyLaunched" || ev.eventName === "CountryLaunched") return ev.args.token;
      } catch { /* other events */ }
    }
    return null;
  }

  return { address, onChain: chainId === CHAIN_ID, pc, send, ensureAllowance, launchedToken };
}
