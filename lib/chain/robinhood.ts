import { defineChain } from "viem";
import { EXPLORER_URL, RPC_RELAY_URL } from "@/lib/config/public";
import { CHAIN_ID } from "@/lib/contracts/constants";

/**
 * Robinhood Chain mainnet (Arbitrum-stack L2). Parameters from Robinhood's official network page
 * (robinhood.com/us/en/support/articles/robinhood-chain-mainnet):
 *   chainId 4663 (0x1237), native currency ETH (18 decimals),
 *   RPC https://rpc.mainnet.chain.robinhood.com, explorer https://robinhoodchain.blockscout.com
 *
 * The app-side RPC is this site's relay (/api/rpc): the public endpoint does not answer requests sent
 * directly from web pages, and Privy's embedded wallet uses rpcUrls.default to estimate and broadcast.
 * Wallet extensions still get the official public URL through ADD_CHAIN_PARAMS.
 */
export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_RELAY_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL },
  },
});

/** Parameters passed verbatim to wallet_addEthereumChain when Robinhood Chain is missing. */
export const ADD_CHAIN_PARAMS = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
} as const;
