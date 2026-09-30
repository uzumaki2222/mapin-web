import { createConfig, injected } from "wagmi";
import { browserTransport } from "@/lib/chain/transport";
import { robinhoodChain } from "@/lib/chain/robinhood";

/**
 * Wallet discovery:
 *  - EIP-6963 (multiInjectedProviderDiscovery): every extension that announces itself
 *    (MetaMask, Rabby, OKX Wallet, Robinhood Wallet, …) becomes its own connector, so we never
 *    depend on whichever extension won the race for `window.ethereum`.
 *  - `injected()` is the legacy fallback for wallets/in-app browsers that only inject
 *    `window.ethereum` (shown only when no EIP-6963 wallet was announced).
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [robinhoodChain.id]: browserTransport() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
