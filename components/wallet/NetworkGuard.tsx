"use client";

import { useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";
import { BSC_CHAIN_ID } from "@/lib/contracts/constants";
import { ADD_BSC_CHAIN_PARAMS } from "@/lib/chain/bsc";
import { decodeError } from "@/lib/errors/decode";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** Global banner: shown whenever a connected wallet is not on BNB Smart Chain. */
export function NetworkGuard() {
  const { isConnected, chainId, connector } = useConnection();
  const { mutateAsync: switchChain, isPending } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!isConnected || chainId === BSC_CHAIN_ID) return null;

  async function addChain() {
    setError(null);
    setAdding(true);
    try {
      const provider = (await connector?.getProvider()) as Eip1193 | undefined;
      if (!provider) throw new Error("Wallet provider unavailable");
      await provider.request({ method: "wallet_addEthereumChain", params: [ADD_BSC_CHAIN_PARAMS] });
    } catch (err) {
      setError(decodeError(err, "Adding BNB Chain").message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="network-banner" role="alert" data-testid="wrong-network">
      <div className="container">
        <strong>Wrong network.</strong>
        <span>mapin runs on BNB Smart Chain (chain 56). Your wallet is on chain {chainId ?? "unknown"}.</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-yellow btn-sm"
          disabled={isPending}
          onClick={async () => {
            setError(null);
            try {
              await switchChain({ chainId: BSC_CHAIN_ID });
            } catch (err) {
              const d = decodeError(err, "Network switch");
              setError(d.kind === "rejected" ? "Network switch was rejected in your wallet." : d.message);
            }
          }}
        >
          {isPending ? <span className="spinner" aria-hidden /> : null} Switch to BNB Chain
        </button>
        <button type="button" className="btn btn-sm" disabled={adding} onClick={addChain}>
          {adding ? <span className="spinner" aria-hidden /> : null} Add BNB Chain
        </button>
        {error ? <span style={{ width: "100%" }}>{error}</span> : null}
      </div>
    </div>
  );
}
