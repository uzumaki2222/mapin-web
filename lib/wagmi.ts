import { createConfig, http, injected } from "wagmi";
import { bscChain } from "@/lib/chain/bsc";
import { PUBLIC_BSC_RPC_URL } from "@/lib/config/public";

/**
 * Wallet discovery:
 *  - EIP-6963 (multiInjectedProviderDiscovery): every extension that announces itself
 *    (MetaMask, Rabby, OKX Wallet, Binance Wallet, …) becomes its own connector, so we never
 *    depend on whichever extension won the race for `window.ethereum`.
 *  - `injected()` is the legacy fallback for wallets/in-app browsers that only inject
 *    `window.ethereum` (shown only when no EIP-6963 wallet was announced).
 */
export const wagmiConfig = createConfig({
  chains: [bscChain],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [bscChain.id]: http(PUBLIC_BSC_RPC_URL, { batch: true, retryCount: 2 }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
