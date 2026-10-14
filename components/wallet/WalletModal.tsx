"use client";

import { useMemo, useState } from "react";
import { useConnect, useConnectors, type Connector } from "wagmi";
import Image from "next/image";
import { Modal } from "@/components/ui/Modal";
import { Notice } from "@/components/ui/Notice";
import { decodeError } from "@/lib/errors/decode";
import { KNOWN_WALLETS, legacyWalletName, mobileDeepLinks, type LegacyFlags } from "@/components/wallet/wallets";

interface Environment {
  legacy: LegacyFlags | null; // window.ethereum, if any
  mobile: boolean;
  href: string;
  host: string;
}

function readEnvironment(): Environment {
  if (typeof window === "undefined") return { legacy: null, mobile: false, href: "", host: "" };
  const eth = (window as unknown as { ethereum?: LegacyFlags }).ethereum;
  return {
    legacy: eth ?? null,
    mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    href: window.location.href,
    host: window.location.host,
  };
}

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Connect wallet">
      {open ? <WalletOptions onClose={onClose} /> : null}
    </Modal>
  );
}

// Mounted fresh every time the modal opens, so errors/busy state never leak between openings.
function WalletOptions({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { mutateAsync: connect } = useConnect();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [env] = useState(readEnvironment);

  // EIP-6963 wallets each get their own connector (id = rdns). "injected" wraps window.ethereum.
  const announced = useMemo(() => connectors.filter((c) => c.id !== "injected"), [connectors]);
  const fallback = useMemo(() => connectors.find((c) => c.id === "injected"), [connectors]);

  // Offer window.ethereum too when the wallet behind it did not announce itself over EIP-6963
  // (older wallets / in-app mobile browsers), so an installed wallet is never missed.
  const legacyName = env.legacy ? legacyWalletName(env.legacy) : null;
  const showLegacy = Boolean(
    fallback && legacyName && !announced.some((c) => c.name.toLowerCase().includes(legacyName.split(" ")[0]!.toLowerCase())),
  );
  const nothingDetected = announced.length === 0 && !showLegacy;
  const missing = KNOWN_WALLETS.filter((w) => !announced.some((c) => w.match.test(c.name)) && !(legacyName && w.match.test(legacyName)));
  const localOnly = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.host);

  async function connectWith(connector: Connector) {
    setBusy(connector.uid);
    setError(null);
    try {
      await connect({ connector });
      onClose();
    } catch (err) {
      const d = decodeError(err, "Wallet connection");
      setError(
        d.kind === "rejected"
          ? "Connection rejected in your wallet."
          : /locked|unlock/i.test(d.message)
            ? "Your wallet is locked. Unlock it and try again."
            : d.message,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        mapin is non-custodial. We never ask for your private key or seed phrase.
      </p>

      {!nothingDetected ? <div className="panel-title" style={{ margin: "4px 0 0" }}>Detected in this browser</div> : null}
      {announced.map((c) => (
        <button key={c.uid} type="button" className="wallet-option" disabled={busy !== null} onClick={() => connectWith(c)}>
          {c.icon ? <Image src={c.icon} alt="" width={28} height={28} unoptimized /> : <span className="wallet-icon">◆</span>}
          <span className="grow">{c.name}</span>
          {busy === c.uid ? <span className="spinner" aria-label="Connecting" /> : <span className="badge badge-yellow">Connect</span>}
        </button>
      ))}
      {showLegacy && fallback ? (
        <button type="button" className="wallet-option" disabled={busy !== null} onClick={() => connectWith(fallback)}>
          <span className="wallet-icon">◆</span>
          <span className="grow">{legacyName}</span>
          {busy === fallback.uid ? <span className="spinner" aria-label="Connecting" /> : <span className="badge badge-yellow">Connect</span>}
        </button>
      ) : null}

      {nothingDetected && env.mobile ? (
        <div className="stack" style={{ gap: 8 }}>
          <Notice tone="warn" title="Open this page in your wallet app">
            Phone browsers (Chrome, Safari) have no wallet. Open mapin inside your wallet app&apos;s built-in browser.
            {localOnly ? " “localhost” only works on the computer running the app — use the computer's network address or a public link." : ""}
          </Notice>
          {!localOnly
            ? mobileDeepLinks(env.href).map((l) => (
                <a key={l.name} className="wallet-option" href={l.url}>
                  <span className="wallet-icon">↗</span>
                  <span className="grow">Open in {l.name}</span>
                </a>
              ))
            : null}
          <span className="tiny muted">Robinhood Wallet: open the app’s built-in browser, then paste this page&apos;s address.</span>
        </div>
      ) : null}
      {nothingDetected && !env.mobile ? (
        <Notice tone="warn" title="No wallet detected in this browser">
          Install a wallet extension in <strong>this</strong> browser (or enable it in your extensions page), unlock it,
          then reload this page.
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>Reload page</button>
          </div>
        </Notice>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {missing.length && !(nothingDetected && env.mobile) ? (
        <details className="small" open={nothingDetected}>
          <summary className="mono" style={{ cursor: "pointer", marginTop: 4 }}>Don&apos;t have a wallet? Install one</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {missing.map((w) => (
              <li key={w.key}>
                <a href={w.installUrl} target="_blank" rel="noopener noreferrer">
                  Install {w.name} ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
