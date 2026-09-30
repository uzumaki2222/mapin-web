"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { LiveTicker } from "@/components/app/LiveTicker";

export function Header() {
  const pathname = usePathname() ?? "/";
  const onLanding = pathname === "/";
  const onDocs = pathname.startsWith("/docs");
  const onMap = pathname === "/app";
  return (
    <>
      <header className="header">
        <div className={`${onMap ? "header-wide" : "container"} header-inner`}>
          <Link href="/" className="brand" aria-label="mapin home">
            <Logo height={40} priority />
          </Link>
          <nav className="header-nav" aria-label="Main">
            {onLanding || onDocs ? (
              <Link href="/docs" aria-current={onDocs ? "page" : undefined}>Docs</Link>
            ) : (
              <>
                <Link href="/app" aria-current={onMap ? "page" : undefined}>Map</Link>
                <Link href="/explore" aria-current={pathname.startsWith("/explore") ? "page" : undefined}>Markets</Link>
                <Link href="/docs">Docs</Link>
              </>
            )}
          </nav>
          <div className="header-actions">
            {onLanding || onDocs ? <Link href="/app" className="btn btn-primary">Launch App</Link> : <ConnectButton />}
          </div>
        </div>
      </header>
      <LiveTicker />
      {onLanding || onDocs ? null : <NetworkGuard />}
    </>
  );
}
