"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { explorerAddress } from "@/lib/config/public";

export function Footer() {
  return (
    <footer className="footer mp-footer">
      <div className="mp-foot-row">
        <div className="mp-foot-brand">
          <Link href="/" className="brand" aria-label="mapin home"><Logo height={40} /><span className="brand-word">mapin</span></Link>
          <p className="mp-foot-slogan">Plant your flag.</p>
        </div>
        <div className="mp-foot-contract">
          <span className="mp-k">Contract</span>
          {MAPIN_LAUNCHPAD ? (
            <a className="mono" href={explorerAddress(MAPIN_LAUNCHPAD)} target="_blank" rel="noopener noreferrer">{MAPIN_LAUNCHPAD.slice(0, 6)}…{MAPIN_LAUNCHPAD.slice(-4)}</a>
          ) : <span className="muted">Deploying soon</span>}
        </div>
      </div>
    </footer>
  );
}
