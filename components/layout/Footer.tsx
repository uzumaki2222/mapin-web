"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";

// Set in Vercel → Environment Variables (then redeploy):
//   NEXT_PUBLIC_X_URL = link to the mapin account on X
//   NEXT_PUBLIC_CA    = the mapin token contract address
const X_URL = (process.env.NEXT_PUBLIC_X_URL ?? "").trim();
const CA = (process.env.NEXT_PUBLIC_CA ?? "").trim();

function XLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="#000">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Footer() {
  const [copied, setCopied] = useState(false);
  // The map is full-screen; a footer would only push it down.
  if (usePathname() === "/app") return null;

  const copy = async () => {
    if (!CA) return;
    try {
      await navigator.clipboard.writeText(CA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <footer className="footer">
      <div className="container row between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div className="row">
          <Logo height={32} />
          <span className="small">Every place on earth, on BNB Smart Chain.</span>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <a
            href={X_URL || undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="mapin on X"
            className="footer-x"
          >
            <XLogo />
          </a>
          <button type="button" className="footer-ca" onClick={copy} disabled={!CA} title={CA ? "Copy contract address" : undefined}>
            <span className="footer-ca-label">CA</span>
            <span className="mono">{CA ? (copied ? "Copied!" : `${CA.slice(0, 6)}…${CA.slice(-4)}`) : "Coming soon"}</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
