"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { explorerAddress } from "@/lib/config/public";

const NAV = [
  { href: "/", label: "Map", hint: "Launch on any country", icon: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zm6-3v15m6-12v15" },
  { href: "/tokens", label: "Tokens", hint: "New, top, graduated", icon: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v10m-3-7h4.5a1.5 1.5 0 010 3H9h5a1.5 1.5 0 010 3H9" },
  { href: "/how-it-works", label: "How it works", hint: "Countries, currencies, curves", icon: "M12 3a9 9 0 100 18 9 9 0 000-18zm-2.5 6.5a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 4m0 3h.01" },
  { href: "/docs", label: "Docs", hint: "Contracts and parameters", icon: "M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/c/") : pathname.startsWith(href));

  return (
    <>
      <header className="header">
        <div className="header-wide header-inner">
          <button type="button" className="mp-burger" aria-label="Open menu" aria-expanded={open} aria-controls="mp-drawer" onClick={() => setOpen(true)}>
            <span /><span /><span />
          </button>
          <Link href="/" className="brand" aria-label="mapin home">
            <Logo height={36} priority />
            <span className="brand-word">mapin</span>
          </Link>
          <div className="header-actions">
            <ConnectButton />
          </div>
        </div>
      </header>

      <div className={`mp-scrim ${open ? "open" : ""}`} onClick={() => setOpen(false)} aria-hidden />
      <aside id="mp-drawer" className={`mp-drawer ${open ? "open" : ""}`} aria-label="Menu" aria-hidden={!open} inert={!open}>
        <div className="mp-drawer-head">
          <Link href="/" className="brand" aria-label="mapin home">
            <Logo height={44} />
            <span><span className="brand-word">mapin</span><small className="mp-drawer-slogan">Every country is a coin.</small></span>
          </Link>
          <button type="button" className="mp-close" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="mp-drawer-wallet">
          <span className="mp-k">Wallet</span>
          <ConnectButton block />
        </div>
        <nav className="mp-drawer-nav" aria-label="Menu">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
              <Icon d={n.icon} />
              <span><b>{n.label}</b><small>{n.hint}</small></span>
            </Link>
          ))}
        </nav>
        <div className="mp-drawer-foot">
          <span className="mp-k">Factory</span>
          {MAPIN_LAUNCHPAD ? (
            <a className="mono" href={explorerAddress(MAPIN_LAUNCHPAD)} target="_blank" rel="noreferrer">{MAPIN_LAUNCHPAD.slice(0, 10)}…{MAPIN_LAUNCHPAD.slice(-6)}</a>
          ) : <span className="muted">Deploying soon</span>}
          <span className="mp-fine">Robinhood Chain · chain 4663</span>
        </div>
      </aside>
      <NetworkGuard />
    </>
  );
}
