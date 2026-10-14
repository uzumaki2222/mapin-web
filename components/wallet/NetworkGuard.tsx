"use client";

import { useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/contracts/constants";
import { ADD_CHAIN_PARAMS } from "@/lib/chain/robinhood";
import { decodeError } from "@/lib/errors/decode";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** Global banner: shown whenever a connected wallet is not on Robinhood Chain. */
export function NetworkGuard() {
  const { isConnected, chainId, connector } = useConnection();
  const { mutateAsync: switchChain, isPending } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!isConnected || chainId === CHAIN_ID) return null;

  async function addChain() {
    setError(null);
    setAdding(true);
    try {
      const provider = (await connector?.getProvider()) as Eip1193 | undefined;
      if (!provider) throw new Error("Wallet provider unavailable");
      await provider.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
    } catch (err) {
      setError(decodeError(err, `Adding ${CHAIN_NAME}`).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="network-banner" role="alert" data-testid="wrong-network">
      <div className="container">
        <strong>Wrong network.</strong>
        <span>mapin runs on {CHAIN_NAME} (chain {CHAIN_ID}). Your wallet is on chain {chainId ?? "unknown"}.</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-yellow btn-sm"
          disabled={isPending}
          onClick={async () => {
            setError(null);
            try {
              await switchChain({ chainId: CHAIN_ID });
            } catch (err) {
              const d = decodeError(err, "Network switch");
              setError(d.kind === "rejected" ? "Network switch was rejected in your wallet." : d.message);
            }
          }}
        >
          {isPending ? <span className="spinner" aria-hidden /> : null} Switch to {CHAIN_NAME}
        </button>
        <button type="button" className="btn btn-sm" disabled={adding} onClick={addChain}>
          {adding ? <span className="spinner" aria-hidden /> : null} Add {CHAIN_NAME}
        </button>
        {error ? <span style={{ width: "100%" }}>{error}</span> : null}
      </div>
    </div>
  );
}
