"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { explorerAddress } from "@/lib/config/public";

// Fill in later: X_URL = the mapin account on X.
const X_URL: string = "";

function AddrLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mp-foot-addr">
      <span className="mp-k">{label}</span>
      {value ? <a className="mono" href={explorerAddress(value)} target="_blank" rel="noopener noreferrer">{value.slice(0, 8)}…{value.slice(-6)}</a> : <span className="muted">Deploying soon</span>}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer mp-footer">
      <div className="mp-foot-grid">
        <div className="mp-foot-brand">
          <Link href="/" className="brand" aria-label="mapin home"><Logo height={40} /><span className="brand-word">mapin</span></Link>
          <p className="mp-foot-slogan">Every country is a coin.</p>
          <p className="mp-fine">Launch any token on any country, paired with its currency coin. Live on Robinhood Chain.</p>
        </div>
        <nav className="mp-foot-col" aria-label="Product">
          <span className="mp-k">Product</span>
          <Link href="/">Map</Link>
          <Link href="/tokens">Tokens</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/docs">Docs</Link>
          {X_URL ? <a href={X_URL} target="_blank" rel="noopener noreferrer">X / Twitter</a> : null}
        </nav>
        <div className="mp-foot-col">
          <span className="mp-k">Contracts</span>
          <AddrLine label="Factory" value={MAPIN_LAUNCHPAD} />
          <div className="mp-foot-addr"><span className="mp-k">Pairs</span><span>Your token / its country&apos;s currency coin</span></div>
          <div className="mp-foot-addr"><span className="mp-k">Network</span><span>Robinhood Chain · 4663</span></div>
        </div>
      </div>
      <div className="mp-foot-bottom">
        <span>© {new Date().getFullYear()} mapin</span>
        <span>Currency coins are community coins, not stablecoins. Unaudited contracts. Trade what you can afford to lose.</span>
      </div>
    </footer>
  );
}
