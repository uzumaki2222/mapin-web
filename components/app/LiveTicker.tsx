"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { RecentTrade } from "@/lib/market/types";
import { timeAgo } from "@/lib/format";
import { formatAmount, marketPath } from "@/lib/validation/normalize";

/** Scrolling strip at the top of every page: the latest launches, buys and sells as they happen. */
export function LiveTicker() {
  const q = useQuery({
    queryKey: ["ticker-trades"],
    queryFn: () => api<{ items: RecentTrade[] }>("/api/activity/recent?limit=30"),
    refetchInterval: 5_000,
  });
  const items = q.data?.items ?? [];

  if (!items.length) {
    return (
      <div className="ticker" aria-label="Live trades">
        <span className="ticker-label"><span className="live-dot" aria-hidden /> LIVE</span>
        <div className="ticker-viewport ticker-empty">
          {q.isError ? "Live trades unavailable right now." : "No trades yet — launches, buys and sells appear here the moment they happen."}
        </div>
      </div>
    );
  }

  const duration = Math.max(25, items.length * 5);
  const row = (hidden: boolean) =>
    items.map((t, i) => {
      const quote = t.quoteVolume ? formatAmount(BigInt(t.quoteVolume), t.quoteDecimals, 4) : null;
      return (
        <Link
          key={`${hidden ? "b" : "a"}-${t.txHash}-${t.type}-${t.symbol}-${i}`}
          href={marketPath(t.slug)}
          className="ticker-item"
          aria-hidden={hidden || undefined}
          tabIndex={hidden ? -1 : undefined}
        >
          <span className={`ticker-type ${t.type}`}>{t.type === "launch" ? "NEW" : t.type === "buy" ? "BUY" : "SELL"}</span>
          <strong>${t.symbol}</strong>
          {t.type === "launch" ? <span>{t.placeName}</span> : quote ? <span>{quote} {t.quoteSymbol}</span> : null}
          <span className="ticker-vol">{timeAgo(t.timestamp)}</span>
        </Link>
      );
    });

  return (
    <div className="ticker" aria-label="Live trades">
      <span className="ticker-label"><span className="live-dot" aria-hidden /> LIVE</span>
      <div className="ticker-viewport">
        <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}
