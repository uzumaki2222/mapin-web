"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { api } from "@/lib/client/api";
import { decodeError } from "@/lib/errors/decode";
import type { SessionInfo } from "@/lib/market/types";
import { CHAIN_ID } from "@/lib/contracts/constants";

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionInfo>("/api/auth/session"), staleTime: 30_000 });
}

/** True when the server session is signed for the wallet that is connected right now. */
export function useIsSignedIn(): boolean {
  const { address } = useConnection();
  const { data } = useSession();
  return Boolean(address && data?.wallet && data.wallet.toLowerCase() === address.toLowerCase());
}

/** Sign-In with Ethereum (EIP-4361) bound to this domain and Robinhood Chain. No gas, no transaction. */
export function useWalletSignIn() {
  const { address } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!address) {
      setError("Connect a wallet first.");
      return false;
    }
    setPending(true);
    setError(null);
    try {
      const n = await api<{ nonce: string; domain: string; uri: string; chainId: number; ttlSeconds: number }>("/api/auth/nonce");
      if (n.domain !== window.location.host) {
        throw new Error(`This site is configured for ${n.domain} but you opened ${window.location.host}. Set NEXT_PUBLIC_APP_URL correctly.`);
      }
      const now = new Date();
      const message = createSiweMessage({
        address,
        chainId: CHAIN_ID,
        domain: n.domain,
        nonce: n.nonce,
        uri: n.uri,
        version: "1",
        statement: "Sign in to mapin. This signature proves you own this wallet. It is not a transaction and costs no gas.",
        issuedAt: now,
        expirationTime: new Date(now.getTime() + Math.min(n.ttlSeconds, 600) * 1000),
      });
      const signature = await signMessage({ message });
      await api("/api/auth/verify", { method: "POST", json: { message, signature } });
      await qc.invalidateQueries({ queryKey: ["session"] });
      return true;
    } catch (err) {
      setError(decodeError(err, "Wallet sign-in").message);
      return false;
    } finally {
      setPending(false);
    }
  }, [address, signMessage, qc]);

  return { signIn, pending, error };
}
