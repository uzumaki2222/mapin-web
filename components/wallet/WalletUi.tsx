"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useDisconnect } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { WalletModal } from "@/components/wallet/WalletModal";

// One interface for "open the connect flow" / "disconnect", whichever wallet layer is active:
//  - Privy (when NEXT_PUBLIC_PRIVY_APP_ID is set): external wallets + email login with embedded wallet
//  - Built-in EIP-6963 modal otherwise
interface WalletUi {
  mode: "privy" | "native";
  ready: boolean;
  openConnect: () => void;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletUi | null>(null);

export function useWalletUi(): WalletUi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWalletUi must be used inside a WalletUi provider");
  return v;
}

export function NativeWalletUi({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { mutateAsync: wagmiDisconnect } = useDisconnect();
  const openConnect = useCallback(() => setOpen(true), []);
  const disconnect = useCallback(async () => {
    await wagmiDisconnect().catch(() => undefined);
  }, [wagmiDisconnect]);
  const value = useMemo<WalletUi>(() => ({ mode: "native", ready: true, openConnect, disconnect }), [openConnect, disconnect]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  );
}

export function PrivyWalletUi({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, connectWallet } = usePrivy();
  const { mutateAsync: wagmiDisconnect } = useDisconnect();
  const openConnect = useCallback(() => {
    // Signed in to Privy but no wallet connected (e.g. extension switched off) → just connect a wallet.
    if (authenticated) connectWallet();
    else login();
  }, [authenticated, connectWallet, login]);
  const disconnect = useCallback(async () => {
    await wagmiDisconnect().catch(() => undefined);
    await logout().catch(() => undefined);
  }, [wagmiDisconnect, logout]);
  const value = useMemo<WalletUi>(() => ({ mode: "privy", ready, openConnect, disconnect }), [ready, openConnect, disconnect]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
