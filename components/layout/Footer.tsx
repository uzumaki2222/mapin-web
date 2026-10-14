"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { SocialLinks } from "@/components/ui/SocialLinks";
import { SLOGAN } from "@/lib/config/social";

export function Footer() {
  return (
    <footer className="footer mp-footer">
      <div className="mp-foot-row">
        <div className="mp-foot-brand">
          <Link href="/" className="mp-foot-logo" aria-label="mapin home">
            <Logo height={60} />
            <span>mapin</span>
          </Link>
          <p className="mp-foot-tag">{SLOGAN}</p>
        </div>
        <SocialLinks size={44} />
      </div>
    </footer>
  );
}
