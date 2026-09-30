import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { bscChain } from "@/lib/chain/bsc";
import { PUBLIC_APP_URL, PUBLIC_BSC_RPC_URL } from "@/lib/config/public";

/** Privy is enabled only when an App ID is configured (Privy dashboard → App settings). */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;

// wagmi config managed by Privy (connectors come from Privy). Must use createConfig from @privy-io/wagmi.
export const privyWagmiConfig = createConfig({
  chains: [bscChain],
  transports: { [bscChain.id]: http(PUBLIC_BSC_RPC_URL, { batch: true, retryCount: 2 }) },
  ssr: true,
});

export const privyConfig = {
  // "wallet" = MetaMask, Rabby, OKX, Binance, WalletConnect…; "email" = login with email + auto-created wallet
  loginMethods: ["wallet", "email"] as ("wallet" | "email")[],
  appearance: {
    theme: "light" as const,
    // Resolved from the page itself so the logo shows even when NEXT_PUBLIC_APP_URL is missing or stale.
    logo: `${typeof window !== "undefined" ? window.location.origin : PUBLIC_APP_URL}/mapin-logo.png`,
    landingHeader: "Connect to mapin",
    loginMessage: "Tokenize any place on earth",
    showWalletLoginFirst: true,
  },
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" as const },
  },
  defaultChain: bscChain,
  supportedChains: [bscChain],
};
