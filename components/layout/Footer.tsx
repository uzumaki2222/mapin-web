"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";

// Set in Vercel → Environment Variables (then redeploy):
//   NEXT_PUBLIC_CA = the mapin token contract address
const CA = (process.env.NEXT_PUBLIC_CA ?? "").trim();

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
      <div className="container footer-inner">
        <div className="footer-brand">
          <Logo height={32} />
          <span className="small">Every place on earth, on BNB Smart Chain.</span>
        </div>
        <button type="button" className="footer-ca" onClick={copy} disabled={!CA} title={CA ? "Copy contract address" : undefined}>
          <span className="footer-ca-label">CA</span>
          <span className="mono">{CA ? (copied ? "Copied!" : `${CA.slice(0, 6)}…${CA.slice(-4)}`) : "Coming soon"}</span>
        </button>
      </div>
    </footer>
  );
}
