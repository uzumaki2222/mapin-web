"use client";

import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";

// Fill in later: X_URL = the mapin account on X.
const X_URL: string = "";

export function Footer() {
  // The map is full-screen; the footer would only push it down.
  if (usePathname() === "/") return null;
  return (
    <footer className="footer">
      <div className="container row between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div className="row">
          <Logo height={32} />
          <span className="small">Every business on earth, on Robinhood Chain.</span>
        </div>
        <div className="row small" style={{ gap: 12 }}>
          <span className="muted">Map data © OpenStreetMap contributors</span>
          {X_URL ? (
            <a href={X_URL} target="_blank" rel="noopener noreferrer" className="btn btn-sm" aria-label="mapin on X">𝕏</a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
