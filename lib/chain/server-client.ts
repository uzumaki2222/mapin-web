import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { robinhoodChain } from "@/lib/chain/robinhood";
import { serverEnv } from "@/lib/config/server";

const g = globalThis as unknown as { __cmPublicClient?: PublicClient; __cmIndexerClient?: PublicClient };

/** Server-side read client (ROBINHOOD_RPC_URL may contain a private API key; it never reaches the browser). */
export function serverPublicClient(): PublicClient {
  if (!g.__cmPublicClient) {
    g.__cmPublicClient = createPublicClient({
      chain: robinhoodChain,
      transport: http(serverEnv().ROBINHOOD_RPC_URL, { retryCount: 2, timeout: 15_000 }),
    }) as PublicClient;
  }
  return g.__cmPublicClient;
}

/** Client for the indexer (needs eth_getLogs support). */
export function indexerPublicClient(): PublicClient {
  const url = serverEnv().ROBINHOOD_INDEXER_RPC_URL;
  if (!url) throw new Error("ROBINHOOD_INDEXER_RPC_URL is not configured");
  if (!g.__cmIndexerClient) {
    g.__cmIndexerClient = createPublicClient({
      chain: robinhoodChain,
      transport: http(url, { retryCount: 3, timeout: 30_000 }),
    }) as PublicClient;
  }
  return g.__cmIndexerClient;
}
