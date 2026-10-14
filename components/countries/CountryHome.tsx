"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatEther } from "viem";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { explorerAddress } from "@/lib/config/public";
import { Notice } from "@/components/ui/Notice";
import { CountryMap, type CountryStatus } from "@/components/countries/CountryMap";
import { useEthUsd, useMapinState, type MapinToken } from "@/components/countries/useMapin";
import { CURRENCY_COUNT, Flag, PLACE, PLACES, SUPPLY, num, tickerFor, type Place } from "@/components/countries/shared";

const MARQUEE_A = ["DZ", "JP", "BR", "GB", "ID", "MY", "NG", "MX", "KR", "TR", "IN", "FR", "ZA", "TH", "AR", "EG"];
const MARQUEE_B = ["US", "DE", "VN", "PH", "SA", "IT", "CO", "KE", "PK", "ES", "CA", "AU", "MA", "PE", "UA", "SG"];

type Row = { token: MapinToken; place: Place | null; label: string; href: string; pair: string; flagId: string | null };

export function CountryHome() {
  const router = useRouter();
  const state = useMapinState();
  const ethUsd = useEthUsd().data ?? null;
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tab, setTab] = useState<"all" | "countries" | "currencies">("all");

  const status = useMemo(() => {
    const s: Record<string, CountryStatus> = {};
    if (!state.data) return s;
    for (const p of PLACES) {
      const c = state.data.countries.get(p.id);
      if (c) s[p.id] = c.graduated ? "graduated" : "live";
      else if (state.data.currencies.has(p.currency)) s[p.id] = "currency";
    }
    return s;
  }, [state.data]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return PLACES.filter((p) => p.name.toLowerCase().includes(s) || p.currency.toLowerCase() === s || p.currencyName.toLowerCase().includes(s)).slice(0, 8);
  }, [q]);

  const rows = useMemo<Row[]>(() => {
    if (!state.data) return [];
    const out: Row[] = [];
    if (tab !== "currencies") {
      for (const t of state.data.countries.values()) {
        const p = PLACE.get(t.key) ?? null;
        const cur = p ? state.data.currencies.get(p.currency) : undefined;
        out.push({ token: t, place: p, label: p?.name ?? t.key, href: `/c/${t.key}`, pair: `$${t.symbol} / $${cur?.symbol ?? p?.currency ?? "?"}`, flagId: p?.id ?? null });
      }
    }
    if (tab !== "countries") {
      for (const t of state.data.currencies.values()) {
        const p = PLACES.find((x) => x.currency === t.key) ?? null;
        out.push({ token: t, place: p, label: p ? p.currencyName : t.key, href: p ? `/c/${p.id}` : "/", pair: `$${t.symbol} / ETH`, flagId: p?.id ?? null });
      }
    }
    return out.sort((a, b) => (b.token.priceEth > a.token.priceEth ? 1 : b.token.priceEth < a.token.priceEth ? -1 : 0));
  }, [state.data, tab]);

  const nCountries = state.data?.countries.size ?? 0;
  const nCurrencies = state.data?.currencies.size ?? 0;
  const hp = hover ? PLACE.get(hover.id) : null;
  const ht = hover && state.data ? state.data.countries.get(hover.id) : undefined;
  const open = (id: string) => router.push(`/c/${id}`);

  return (
    <div className="mp">
      {/* ---------------------------------------------------------------- hero */}
      <section className="mp-hero">
        <div className="mp-hero-copy">
          <p className="mp-eyebrow">Robinhood Chain mainnet · {PLACES.length} countries · {CURRENCY_COUNT} currencies</p>
          <h1>Every country<br />is a <span className="mp-hl">coin.</span></h1>
          <p className="mp-lede">
            Click a country and launch its coin. It trades against its own currency coin:
            <b> $ALGERIA/$DZD</b>, <b>$JAPAN/$JPY</b>, <b>$UK/$GBP</b>. Pay with ETH, the route is handled for you.
          </p>
          <div className="mp-cta">
            <a className="btn btn-yellow btn-lg" href="#map">Pick a country</a>
            <a className="btn btn-lg" href="#how">How it works</a>
          </div>
          <dl className="mp-kpis">
            <div><dt>Countries live</dt><dd>{nCountries}<small>/{PLACES.length}</small></dd></div>
            <div><dt>Currency coins</dt><dd>{nCurrencies}<small>/{CURRENCY_COUNT}</small></dd></div>
            <div><dt>Contract</dt><dd className="mp-kpi-addr">{MAPIN_LAUNCHPAD ? <a href={explorerAddress(MAPIN_LAUNCHPAD)} target="_blank" rel="noreferrer">{MAPIN_LAUNCHPAD.slice(0, 6)}…{MAPIN_LAUNCHPAD.slice(-4)}</a> : "not set"}</dd></div>
          </dl>
        </div>
        <div className="mp-hero-art" aria-hidden>
          <div className="mp-stack">
            {[["DZ", "ALGERIA", "DZD"], ["JP", "JAPAN", "JPY"], ["GB", "UK", "GBP"]].map(([id, t, c], i) => (
              <div key={id} className={`mp-coin mp-coin-${i}`}>
                <Flag id={id!} size={64} />
                <div><b>${t}</b><span>/ ${c}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- flags marquee */}
      <div className="mp-marquee" aria-hidden>
        {[MARQUEE_A, MARQUEE_B].map((row, r) => (
          <div key={r} className={`mp-track ${r ? "rev" : ""}`}>
            {[...row, ...row].map((id, i) => {
              const p = PLACE.get(id);
              return p ? (
                <span key={`${id}-${i}`} className="mp-tile"><Flag id={id} size={28} /><b>${tickerFor(p.name)}</b><em>/{p.currency}</em></span>
              ) : null;
            })}
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------------- map */}
      <section id="map" className="mp-section">
        <div className="mp-section-head">
          <div>
            <p className="mp-eyebrow">01 · The map</p>
            <h2>Click a country to launch or trade it</h2>
          </div>
          <div className="mp-search">
            <input className="input" placeholder="Search a country or currency (Algeria, MYR…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search countries" />
            {hits.length ? (
              <div className="mp-results">
                {hits.map((p) => (
                  <button key={p.id} type="button" onClick={() => open(p.id)}>
                    <Flag id={p.id} size={18} /><span>{p.name}</span><em>{p.currency}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mp-mapwrap">
          <CountryMap status={status} onSelect={open} onHover={setHover} />
          {hover && hp ? (
            <div className="mp-tip" style={{ left: hover.x, top: hover.y }}>
              <Flag id={hp.id} size={16} /> <b>{hp.name}</b> <span>{ht ? `$${ht.symbol} live` : `${hp.currency} · launch it`}</span>
            </div>
          ) : null}
          <div className="mp-legend">
            <span><i className="l0" />Not launched</span>
            <span><i className="l1" />Currency coin live</span>
            <span><i className="l2" />Country coin live</span>
            <span><i className="l3" />Graduated</span>
          </div>
        </div>
        {!MAPIN_LAUNCHPAD ? <Notice tone="error" title="Contract not set">Set NEXT_PUBLIC_MAPIN_LAUNCHPAD or lib/contracts/mapin-deployment.json.</Notice> : null}
        {state.error ? <Notice tone="error" title="Could not read the chain">{(state.error as Error).message.slice(0, 200)}</Notice> : null}
      </section>

      {/* ---------------------------------------------------------------- board */}
      <section id="board" className="mp-section">
        <div className="mp-section-head">
          <div>
            <p className="mp-eyebrow">02 · Live board</p>
            <h2>Every coin on the map</h2>
          </div>
          <div className="mp-chips" role="group" aria-label="Filter">
            {(["all", "countries", "currencies"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === "all" ? `All ${nCountries + nCurrencies}` : t === "countries" ? `Countries ${nCountries}` : `Currencies ${nCurrencies}`}
              </button>
            ))}
          </div>
        </div>
        {state.isLoading ? <div className="mp-empty">Reading Robinhood Chain…</div> : rows.length === 0 ? (
          <div className="mp-empty">
            <b>Nothing launched yet.</b> Pick a country on the map and be the first. You earn the creator fee on every trade of the coin you launch.
          </div>
        ) : (
          <div className="mp-board" role="table">
            <div className="mp-board-row mp-board-head" role="row">
              <span>Coin</span><span>Pair</span><span>Price</span><span>Market cap</span><span>Curve</span>
            </div>
            {rows.map((r) => {
              const price = Number(formatEther(r.token.priceEth));
              const mcap = price * SUPPLY;
              return (
                <Link key={r.token.address} href={r.href} className="mp-board-row" role="row">
                  <span className="mp-coincell">{r.flagId ? <Flag id={r.flagId} size={22} /> : null}<b>${r.token.symbol}</b><em>{r.label}</em></span>
                  <span className="mono">{r.pair}</span>
                  <span className="mono">{num(price)} ETH</span>
                  <span className="mono">{num(mcap)} ETH{ethUsd ? <small> ≈ ${num(mcap * ethUsd)}</small> : null}</span>
                  <span className="mp-curve">{r.token.graduated ? <em className="mp-grad">Graduated</em> : <><i style={{ width: `${Math.max(2, r.token.progressBps / 100)}%` }} /><small>{(r.token.progressBps / 100).toFixed(1)}%</small></>}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- how */}
      <section id="how" className="mp-section">
        <p className="mp-eyebrow">03 · How it works</p>
        <h2>Two coins per country, one click to trade</h2>
        <ol className="mp-steps">
          <li><span>01</span><h3>Pick a country</h3><p>Every country is registered on-chain with its national currency. Algeria uses DZD, Malaysia MYR, the United Kingdom GBP.</p></li>
          <li><span>02</span><h3>Launch the currency coin</h3><p>The first time a currency is used, someone launches its coin, like $DZD, paired with ETH. Every country using that currency trades against it.</p></li>
          <li><span>03</span><h3>Launch and trade the country</h3><p>$ALGERIA trades against $DZD on its own bonding curve. Buy with ETH: the contract routes ETH → $DZD → $ALGERIA in one transaction.</p></li>
        </ol>
        <p className="mp-fine">Currency coins are community meme coins with a free market price. They are not stablecoins and are not worth the real currency. The contract is not audited; trade amounts you can afford to lose.</p>
      </section>
    </div>
  );
}
