"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/client/api";
import type { MarketSummary } from "@/lib/market/types";
import { MarketCard } from "@/components/market/MarketCard";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { useQuoteAssets } from "@/hooks/useQuoteAssets";
import { LiveFeed } from "@/components/app/LiveFeed";

const SECTIONS = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "graduated", label: "Graduated" },
  { key: "all", label: "All" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];
type StatusFilter = "all" | "bonding" | "graduated";
const PAGE = 24;

export function ExploreView() {
  const [section, setSection] = useState<Section>("trending");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [quote, setQuote] = useState<string>("all");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const quotes = useQuoteAssets();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(input.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ section, limit: String(PAGE), offset: String(page * PAGE) });
    if (status !== "all" && section !== "graduated") p.set("status", status);
    if (quote !== "all") p.set("quote", quote);
    if (q) p.set("q", q);
    return p.toString();
  }, [section, status, quote, q, page]);

  const markets = useQuery({
    queryKey: ["markets", params],
    queryFn: () => api<{ items: MarketSummary[]; total: number }>(`/api/markets?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: 5_000,
  });

  const total = markets.data?.total ?? 0;

  return (
    <div className="container section">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>Explore</h1>
        <Link href="/app" className="btn btn-primary">Open the map</Link>
      </div>

      <LiveFeed />

      <div className="tabs" role="tablist" aria-label="Market sections">
        {SECTIONS.map((s) => (
          <button key={s.key} role="tab" aria-selected={section === s.key} onClick={() => { setSection(s.key); setPage(0); }}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ margin: "16px 0", alignItems: "flex-end" }}>
        <div className="field grow" style={{ minWidth: 240 }}>
          <label className="label" htmlFor="search">Search</label>
          <input
            id="search"
            className="input"
            placeholder="Place, country, ticker or token address (0x…)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label">Status</span>
          <div className="seg" role="group" aria-label="Status filter">
            {(["all", "bonding", "graduated"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => { setStatus(s); setPage(0); }} disabled={section === "graduated" && s !== "all"}>
                {s === "all" ? "All" : s === "bonding" ? "Bonding" : "Graduated"}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="pair">Pair</label>
          <select id="pair" className="select" value={quote} onChange={(e) => { setQuote(e.target.value); setPage(0); }}>
            <option value="all">All pairs</option>
            {quotes.data?.assets.map((a) => (
              <option key={a.address} value={a.address}>{a.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      {markets.isError ? (
        <Notice tone="error" title="Could not load markets">{(markets.error as Error).message}</Notice>
      ) : markets.isLoading ? (
        <Spinner label="Loading markets…" />
      ) : markets.data && markets.data.items.length === 0 ? (
        <div className="empty">
          {q ? <p>No market matches “{q}”.</p> : section === "trending" ? <p>No trades in the last 24 hours yet.</p> : <p>No markets here yet.</p>}
          <Link href="/app" className="btn btn-primary">Pick a place on the map</Link>
        </div>
      ) : (
        <>
          <div className="grid grid-3" style={{ opacity: markets.isFetching ? 0.7 : 1 }}>
            {markets.data?.items.map((m) => <MarketCard key={m.id} m={m} />)}
          </div>
          {total > PAGE ? (
            <div className="row" style={{ justifyContent: "center", marginTop: 24 }}>
              <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span className="mono small">Page {page + 1} / {Math.ceil(total / PAGE)}</span>
              <button type="button" className="btn btn-sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
