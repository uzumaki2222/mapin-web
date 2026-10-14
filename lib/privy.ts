import { createConfig } from "@privy-io/wagmi";
import { browserTransport } from "@/lib/chain/transport";
import { robinhoodChain } from "@/lib/chain/robinhood";
import { PUBLIC_APP_URL } from "@/lib/config/public";

/**
 * Privy App ID (dashboard.privy.io → App settings). The App ID is public by design; the env var
 * overrides the built-in mapin app. Add https://mapinpad.fun to the app's allowed domains.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmv5o98fj001r0fii3w55e3r9";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;

// wagmi config managed by Privy (connectors come from Privy). Must use createConfig from @privy-io/wagmi.
export const privyWagmiConfig = createConfig({
  chains: [robinhoodChain],
  transports: { [robinhoodChain.id]: browserTransport() },
  ssr: true,
});

export const privyConfig = {
  // "wallet" = MetaMask, Rabby, OKX, Robinhood Wallet, WalletConnect…; "email" = login with email + auto-created wallet
  loginMethods: ["wallet", "email"] as ("wallet" | "email")[],
  appearance: {
    theme: "light" as const,
    accentColor: "#FFC400" as const,
    logo: `${PUBLIC_APP_URL}/mapin-logo.png`,
    landingHeader: "Connect to mapin",
    loginMessage: "Tokenize any business on earth",
    showWalletLoginFirst: true,
  },
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" as const },
  },
  defaultChain: robinhoodChain,
  supportedChains: [robinhoodChain],
};
