"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { RecentTrade } from "@/lib/market/types";
import { timeAgo } from "@/lib/format";
import { formatAmount, marketPath, shortenAddress } from "@/lib/validation/normalize";
import { TokenLogo } from "@/components/ui/TokenLogo";

const key = (t: RecentTrade) => `${t.txHash}-${t.type}-${t.symbol}`;

/** Live launches, buys and sells across every market; new items flash in at the top. */
export function LiveFeed() {
  const q = useQuery({
    queryKey: ["recent-trades"],
    queryFn: () => api<{ items: RecentTrade[] }>("/api/activity/recent?limit=12"),
    refetchInterval: 4_000,
  });

  // Remember which trades were already on screen so only new ones animate.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const items = q.data?.items;
  useEffect(() => {
    if (!items) return;
    const keys = items.map(key);
    if (seen.current) {
      const prev = seen.current;
      const added = new Set(keys.filter((k) => !prev.has(k)));
      if (added.size) setFresh(added);
    }
    seen.current = new Set(keys);
  }, [items]);

  // Re-render every 10s so "time ago" stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="live-feed" aria-label="Live launches and trades">
      <div className="live-feed-head">
        <span className="live-dot" aria-hidden />
        <strong>LIVE FEED</strong>
      </div>
      {q.isError ? (
        <p className="live-feed-empty">Live feed unavailable right now.</p>
      ) : !items ? (
        <p className="live-feed-empty">Connecting…</p>
      ) : items.length === 0 ? (
        <p className="live-feed-empty">No activity yet. Launches, buys and sells show up here the moment they happen.</p>
      ) : (
        <ul className="live-feed-list">
          {items.map((t) => {
            const k = key(t);
            const quote = t.quoteVolume ? formatAmount(BigInt(t.quoteVolume), t.quoteDecimals, 4) : "—";
            const tokens = t.tokenAmount ? formatAmount(BigInt(t.tokenAmount), 18, 0) : null;
            return (
              <li key={k} className={fresh.has(k) ? "is-new" : undefined}>
                <Link href={marketPath(t.slug)} className="live-row">
                  <TokenLogo src={t.imageUrl} symbol={t.symbol} />
                  <span className={`live-type ${t.type === "sell" ? "neg" : "pos"}`}>{t.type === "launch" ? "NEW" : t.type === "buy" ? "BUY" : "SELL"}</span>
                  {t.type === "launch" ? (
                    <span className="live-main">
                      <strong>{t.businessName}</strong>
                      <span className="muted"> tokenized as ${t.symbol}{t.city ? ` · ${t.city}` : ""}</span>
                    </span>
                  ) : (
                    <span className="live-main">
                      <strong>{quote} {t.quoteSymbol}</strong>
                      <span className="muted"> of ${t.symbol}{tokens ? ` · ${tokens}` : ""}</span>
                    </span>
                  )}
                  <span className="live-meta muted">
                    {t.wallet ? shortenAddress(t.wallet) : ""} · {timeAgo(t.timestamp)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
