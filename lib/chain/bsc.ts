import { defineChain } from "viem";
import { bsc as viemBsc } from "viem/chains";
import { PUBLIC_BSC_RPC_URL, BSC_EXPLORER_URL } from "@/lib/config/public";

/**
 * BNB Smart Chain Mainnet. Parameters used for wallet_addEthereumChain:
 *   chainId 56 (0x38), native currency BNB (18 decimals),
 *   RPC https://bsc-dataseed.bnbchain.org (official, docs.bnbchain.org), explorer https://bscscan.com
 * Multicall3 and other contract metadata are inherited from viem's chain definition.
 */
export const bscChain = defineChain({
  ...viemBsc,
  id: 56,
  name: "BNB Smart Chain Mainnet",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: [PUBLIC_BSC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: BSC_EXPLORER_URL },
  },
});

/** Parameters passed verbatim to wallet_addEthereumChain when BNB Chain is missing. */
export const ADD_BSC_CHAIN_PARAMS = {
  chainId: "0x38",
  chainName: "BNB Smart Chain Mainnet",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  blockExplorerUrls: ["https://bscscan.com"],
} as const;
