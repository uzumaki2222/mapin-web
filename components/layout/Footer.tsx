"use client";

import { Logo } from "@/components/ui/Logo";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { explorerAddress } from "@/lib/config/public";

// Fill in later: X_URL = the mapin account on X.
const X_URL: string = "";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container row between" style={{ flexWrap: "wrap", gap: 12, paddingTop: 20, paddingBottom: 20 }}>
        <div className="row">
          <Logo height={30} />
          <span className="small">Every country is a coin. On Robinhood Chain.</span>
        </div>
        <div className="row small" style={{ gap: 12 }}>
          {MAPIN_LAUNCHPAD ? (
            <a className="muted mono" href={explorerAddress(MAPIN_LAUNCHPAD)} target="_blank" rel="noopener noreferrer">
              Contract {MAPIN_LAUNCHPAD.slice(0, 6)}…{MAPIN_LAUNCHPAD.slice(-4)}
            </a>
          ) : null}
          {X_URL ? (
            <a href={X_URL} target="_blank" rel="noopener noreferrer" className="btn btn-sm" aria-label="mapin on X">𝕏</a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
