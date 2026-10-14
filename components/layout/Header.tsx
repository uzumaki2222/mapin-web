"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { TrendingTicker } from "@/components/app/TrendingTicker";

export function Header() {
  const pathname = usePathname() ?? "/";
  const onMap = pathname === "/";
  return (
    <>
      <header className="header">
        <div className={`${onMap ? "header-wide" : "container"} header-inner`}>
          <Link href="/" className="brand" aria-label="mapin home">
            <Logo height={38} priority />
            <span className="brand-word">mapin</span>
          </Link>
          <nav className="header-nav" aria-label="Main">
            <Link href="/#map" aria-current={onMap ? "page" : undefined}>Map</Link>
            <Link href="/#board">Board</Link>
          </nav>
          <div className="header-actions">
            <ConnectButton />
          </div>
        </div>
      </header>
      {!onMap ? <TrendingTicker /> : null}
      <NetworkGuard />
    </>
  );
}
