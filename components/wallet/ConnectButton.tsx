"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useBalance } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletUi } from "@/components/wallet/WalletUi";
import { useIsSignedIn, useSession, useWalletSignIn } from "@/hooks/useSession";
import { shortenAddress, formatAmount } from "@/lib/validation/normalize";
import { BSC_CHAIN_ID } from "@/lib/contracts/constants";
import { explorerAddress } from "@/lib/config/public";
import { CopyButton } from "@/components/ui/CopyButton";
import { api } from "@/lib/client/api";

export function ConnectButton({ block = false }: { block?: boolean }) {
  const { address, status, chainId, connector } = useConnection();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const walletUi = useWalletUi();
  const qc = useQueryClient();
  const onBsc = chainId === BSC_CHAIN_ID;
  const balance = useBalance({ address, chainId: BSC_CHAIN_ID, query: { enabled: Boolean(address), refetchInterval: 15_000 } });
  const session = useSession();
  const signedIn = useIsSignedIn();
  const { signIn, pending: signing, error: signError } = useWalletSignIn();

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  if (status !== "connected" || !address) {
    return (
      <>
        <button
          type="button"
          className={`btn btn-primary${block ? " btn-block" : ""}`}
          onClick={walletUi.openConnect}
          disabled={!walletUi.ready || status === "connecting" || status === "reconnecting"}
          data-testid="connect-wallet"
        >
          {!walletUi.ready || status === "connecting" || status === "reconnecting" ? <span className="spinner" aria-hidden /> : null}
          Connect Wallet
        </button>
      </>
    );
  }

  const bnb = balance.data ? formatAmount(balance.data.value, balance.data.decimals, 4) : null;

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <button type="button" className="account-chip" onClick={() => setMenu((m) => !m)} aria-expanded={menu} data-testid="account-chip">
        <span className="dot" style={{ color: onBsc ? "var(--green)" : "var(--red)" }} aria-hidden />
        <span>{shortenAddress(address)}</span>
        <span className="muted">{onBsc ? (bnb !== null ? `${bnb} BNB` : "… BNB") : "Wrong network"}</span>
      </button>
      {menu ? (
        <div className="account-menu" role="menu">
          <div className="row between">
            <span className="mono small">{shortenAddress(address, 6)}</span>
            <CopyButton value={address} />
          </div>
          <dl className="kv">
            <dt>Wallet</dt>
            <dd>{connector?.name ?? "—"}</dd>
            <dt>Network</dt>
            <dd className={onBsc ? "pos" : "neg"}>{onBsc ? "BNB Chain ✓" : `Chain ${chainId ?? "?"}`}</dd>
            <dt>Balance</dt>
            <dd>{balance.isError ? "RPC unavailable" : bnb !== null ? `${bnb} BNB` : "…"}</dd>
            <dt>Session</dt>
            <dd>{signedIn ? "Signed in" : "Not signed in"}</dd>
          </dl>
          {!signedIn && session.data?.configured.sessions ? (
            <button type="button" className="btn btn-yellow btn-sm" disabled={signing} onClick={() => signIn()}>
              {signing ? <span className="spinner" aria-hidden /> : null} Sign in with wallet
            </button>
          ) : null}
          {signError ? <span className="error-text">{signError}</span> : null}
          <a className="btn btn-sm" href={explorerAddress(address)} target="_blank" rel="noopener noreferrer">View on BscScan ↗</a>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={async () => {
              setMenu(false);
              await walletUi.disconnect();
              await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
              await qc.invalidateQueries({ queryKey: ["session"] });
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
