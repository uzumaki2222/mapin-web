"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { MarketSummary } from "@/lib/market/types";
import { fmtPrice, fmtQuote } from "@/lib/format";
import { marketPath } from "@/lib/validation/normalize";

type List = { items: MarketSummary[]; total: number };

/** Scrolling strip (right → left) of the markets trading the most right now. */
export function TrendingTicker() {
  const q = useQuery({
    queryKey: ["ticker"],
    queryFn: async () => {
      const trending = await api<List>("/api/markets?section=trending&limit=20");
      if (trending.items.length) return { items: trending.items, trending: true };
      // Nothing traded in the last 24h yet: show the newest markets instead.
      const fresh = await api<List>("/api/markets?section=new&limit=20");
      return { items: fresh.items, trending: false };
    },
    refetchInterval: 15_000,
  });

  const items = q.data?.items ?? [];
  if (!items.length) return null;

  // The list is rendered twice so the loop is seamless; slower for longer lists.
  const duration = Math.max(20, items.length * 6);
  const row = (hidden: boolean) =>
    items.map((m) => (
      <Link
        key={`${hidden ? "b" : "a"}-${m.id}`}
        href={marketPath(m.slug)}
        className="ticker-item"
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : undefined}
      >
        <strong>${m.symbol}</strong>
        <span>{fmtPrice(m.priceWad, m.quoteSymbol)}</span>
        {Number(m.volume24h) > 0 ? <span className="ticker-vol">VOL {fmtQuote(m.volume24h, m.quoteDecimals, m.quoteSymbol)}</span> : null}
      </Link>
    ));

  return (
    <div className="ticker" aria-label={q.data?.trending ? "Trending markets" : "New markets"}>
      <span className="ticker-label">{q.data?.trending ? "🔥 TRENDING" : "✨ NEW"}</span>
      <div className="ticker-viewport">
        <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}
