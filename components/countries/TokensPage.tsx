"use client";

import { useMemo, useState } from "react";
import { useEthUsd, useMapinState, type MapinToken } from "@/components/countries/useMapin";
import { NEW_WINDOW_SEC, TokenCard, placeOf } from "@/components/countries/shared";
import { Notice } from "@/components/ui/Notice";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";

type Tab = "new" | "top" | "near" | "graduated" | "currencies";
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "new", label: "New", hint: "Freshest launches first" },
  { id: "top", label: "Top", hint: "Highest market cap" },
  { id: "near", label: "Near graduation", hint: "Bonding curve 50% or more" },
  { id: "graduated", label: "Graduated", hint: "Curve full, heading to the DEX" },
  { id: "currencies", label: "Currency coins", hint: "The coins every country pairs with" },
];

export function TokensPage() {
  const state = useMapinState();
  const ethUsd = useEthUsd().data ?? null;
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = state.data?.countries ?? [];
    const now = Date.now() / 1000;
    return {
      new: c.filter((t) => now - t.createdAt < NEW_WINDOW_SEC).length,
      top: c.length,
      near: c.filter((t) => !t.graduated && t.progressBps >= 5000).length,
      graduated: c.filter((t) => t.graduated).length,
      currencies: state.data?.currencies.size ?? 0,
    };
  }, [state.data]);

  const list = useMemo<MapinToken[]>(() => {
    if (!state.data) return [];
    const c = [...state.data.countries];
    let out: MapinToken[];
    if (tab === "new") out = c.sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === "top") out = c.sort((a, b) => (b.priceEth > a.priceEth ? 1 : b.priceEth < a.priceEth ? -1 : 0));
    else if (tab === "near") out = c.filter((t) => !t.graduated && t.progressBps >= 5000).sort((a, b) => b.progressBps - a.progressBps);
    else if (tab === "graduated") out = c.filter((t) => t.graduated);
    else out = [...state.data.currencies.values()].sort((a, b) => (b.priceEth > a.priceEth ? 1 : b.priceEth < a.priceEth ? -1 : 0));
    const s = q.trim().toLowerCase();
    if (!s) return out;
    return out.filter((t) => {
      const p = placeOf(t);
      return t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || (p?.name.toLowerCase().includes(s) ?? false) || t.key.toLowerCase() === s;
    });
  }, [state.data, tab, q]);

  const quoteOf = (t: MapinToken) => {
    if (t.kind === 1) return "ETH";
    const p = placeOf(t);
    const cur = p ? state.data?.currencies.get(p.currency) : undefined;
    return `$${cur?.symbol ?? p?.currency ?? "?"}`;
  };

  return (
    <div className="mp mp-page">
      <header className="mp-pagehead">
        <p className="mp-eyebrow">Tokens</p>
        <h1>Every token on the map</h1>
        <p className="mp-lede">Each token sits on a country and trades against that country&apos;s currency coin. New launches get a <em className="mp-tag new">New</em> tag for their first 24 hours.</p>
      </header>

      <div className="mp-section-head mp-toolbar">
        <div className="mp-chips" role="tablist" aria-label="Token lists">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-pressed={tab === t.id} aria-selected={tab === t.id} title={t.hint} onClick={() => setTab(t.id)}>
              {t.label} <span className="mp-count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="mp-search"><input className="input" placeholder="Search ticker, name or country" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tokens" /></div>
      </div>
      <p className="mp-fine">{TABS.find((t) => t.id === tab)!.hint}</p>

      {!MAPIN_LAUNCHPAD ? <Notice tone="warn" title="Launches open shortly">The launchpad contract is being upgraded.</Notice> : null}
      {state.error ? <Notice tone="error" title="Could not read the chain">{(state.error as Error).message.slice(0, 200)}</Notice> : null}

      {state.isLoading && !state.data ? <div className="mp-empty">Reading Robinhood Chain…</div> : list.length ? (
        <div className="mp-tgrid">{list.map((t) => <TokenCard key={t.address} token={t} quoteSymbol={quoteOf(t)} ethUsd={ethUsd} />)}</div>
      ) : (
        <div className="mp-empty"><b>Nothing here yet.</b> {tab === "new" ? "Open the map, pick a country and launch the first one." : "Check another tab, or launch one from the map."}</div>
      )}
    </div>
  );
}
