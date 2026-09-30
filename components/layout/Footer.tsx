"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";

// Fill in later: X_URL = the mapin account on X.
const X_URL: string = "";

export function Footer() {
  // The map is full-screen; a footer would only push it down.
  if (usePathname() === "/app") return null;
  return (
    <footer className="footer">
      <div className="container row between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div className="row">
          <Logo height={32} />
          <span className="small">Every place on earth, on BNB Smart Chain.</span>
        </div>
        <div className="row small" style={{ gap: 14 }}>
          <Link href="/docs">Docs</Link>
          <Link href="/app">App</Link>
          {X_URL ? <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="mapin on X">𝕏</a> : null}
          <span className="muted">Map data © OpenStreetMap contributors</span>
        </div>
      </div>
    </footer>
  );
}
