"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, privyConfig, privyWagmiConfig } from "@/lib/privy";
import { NativeWalletUi, PrivyWalletUi } from "@/components/wallet/WalletUi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } }),
  );

  if (PRIVY_APP_ID) {
    // Order required by Privy: PrivyProvider > QueryClientProvider > WagmiProvider (from @privy-io/wagmi).
    return (
      <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID} config={privyConfig}>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={privyWagmiConfig}>
            <PrivyWalletUi>{children}</PrivyWalletUi>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NativeWalletUi>{children}</NativeWalletUi>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
