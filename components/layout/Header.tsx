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
          <Link href="/" className="brand" aria-label="mapin — world map">
            <Logo height={40} priority />
          </Link>
          <nav className="header-nav" aria-label="Main">
            <Link href="/" aria-current={onMap ? "page" : undefined}>Map</Link>
            <Link href="/explore" aria-current={pathname.startsWith("/explore") ? "page" : undefined}>Markets</Link>
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
