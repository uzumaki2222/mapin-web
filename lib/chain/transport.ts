import { fallback, http } from "viem";
import { PUBLIC_RPC_URL, RPC_RELAY_URL } from "@/lib/config/public";

/**
 * Browser RPC transport for Robinhood Chain.
 *  1. this site's relay (/api/rpc) — the public RPC does not answer requests made directly from web pages
 *  2. the public RPC directly, as a last resort (works where the visitor's browser is allowed through)
 * One request per call (no JSON-RPC batching).
 */
export function browserTransport() {
  const relay = typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : RPC_RELAY_URL;
  return fallback(
    [
      http(relay, { retryCount: 2, timeout: 25_000 }),
      http(PUBLIC_RPC_URL, { retryCount: 0, timeout: 10_000 }),
    ],
    { rank: false },
  );
}
