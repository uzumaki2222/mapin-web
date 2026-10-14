"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { explorerAddress } from "@/lib/config/public";
import { Notice } from "@/components/ui/Notice";
import { CountryMap, type CountryStatus } from "@/components/countries/CountryMap";
import { useMapinState } from "@/components/countries/useMapin";
import { CURRENCY_COUNT, Flag, PLACE, PLACES, tickerFor } from "@/components/countries/shared";

const MARQUEE_A = ["DZ", "JP", "BR", "GB", "ID", "MY", "NG", "MX", "KR", "TR", "IN", "FR", "ZA", "TH", "AR", "EG"];
const MARQUEE_B = ["US", "DE", "VN", "PH", "SA", "IT", "CO", "KE", "PK", "ES", "CA", "AU", "MA", "PE", "UA", "SG"];

export function CountryHome() {
  const router = useRouter();
  const state = useMapinState();
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const status = useMemo(() => {
    const s: Record<string, CountryStatus> = {};
    if (!state.data) return s;
    for (const p of PLACES) {
      const list = state.data.byPlace.get(p.id);
      if (list?.length) s[p.id] = list.some((t) => !t.graduated) ? "live" : "graduated";
      else if (state.data.currencies.has(p.currency)) s[p.id] = "currency";
    }
    return s;
  }, [state.data]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return PLACES.filter((p) => p.name.toLowerCase().includes(s) || p.currency.toLowerCase() === s || p.currencyName.toLowerCase().includes(s)).slice(0, 8);
  }, [q]);

  const nTokens = state.data?.countries.length ?? 0;
  const nCountries = state.data ? [...state.data.byPlace.keys()].length : 0;
  const nCurrencies = state.data?.currencies.size ?? 0;
  const hp = hover ? PLACE.get(hover.id) : null;
  const ht = hover && state.data ? state.data.byPlace.get(hover.id) ?? [] : [];
  const open = (id: string) => router.push(`/c/${id}`);

  return (
    <div className="mp">
      {/* ---------------------------------------------------------------- hero */}
      <section className="mp-hero">
        <div className="mp-hero-copy">
          <p className="mp-eyebrow">Robinhood Chain mainnet · {PLACES.length} countries · {CURRENCY_COUNT} currencies</p>
          <h1>Every country<br />is a <span className="mp-hl">coin.</span></h1>
          <p className="mp-lede">
            Pick a country on the map and launch any token you like: your name, your ticker. It is paired with
            that country&apos;s own currency coin, so a token on Algeria trades against <b>$DZD</b>, on Japan against
            <b> $JPY</b>, on the UK against <b>$GBP</b>. Pay with ETH; the contract routes it for you.
          </p>
          <div className="mp-cta">
            <a className="btn btn-yellow btn-lg" href="#map">Launch on the map</a>
            <Link className="btn btn-lg" href="/tokens">Browse tokens</Link>
          </div>
          <dl className="mp-kpis">
            <div><dt>Tokens</dt><dd>{nTokens}<small> on {nCountries} countries</small></dd></div>
            <div><dt>Currency coins</dt><dd>{nCurrencies}<small>/{CURRENCY_COUNT}</small></dd></div>
            <div><dt>Contract</dt><dd className="mp-kpi-addr">{MAPIN_LAUNCHPAD ? <a href={explorerAddress(MAPIN_LAUNCHPAD)} target="_blank" rel="noreferrer">{MAPIN_LAUNCHPAD.slice(0, 6)}…{MAPIN_LAUNCHPAD.slice(-4)}</a> : "not set"}</dd></div>
          </dl>
        </div>
        <div className="mp-hero-art" aria-hidden>
          <div className="mp-stack">
            {[["DZ", "ALGERIA", "DZD"], ["JP", "JAPAN", "JPY"], ["GB", "UK", "GBP"]].map(([id, t, c], i) => (
              <div key={id} className={`mp-coin mp-coin-${i}`}>
                <Flag id={id!} size={64} />
                <div><b>${t}</b><span>/ ${c} / ETH</span></div>
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
            <p className="mp-eyebrow">The map</p>
            <h2>Click a country. Name your token. Launch.</h2>
            <p className="mp-sub">Every country is already wired to its currency. Zoom in to see more names; hover to see how many tokens live there.</p>
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
              <Flag id={hp.id} size={16} /> <b>{hp.name}</b> <span>{ht.length ? `${ht.length} token${ht.length > 1 ? "s" : ""} · $${hp.currency}` : `$${hp.currency} · be the first`}</span>
            </div>
          ) : null}
          <div className="mp-legend">
            <span><i className="l0" />Not launched</span>
            <span><i className="l1" />Currency coin live</span>
            <span><i className="l2" />Has tokens</span>
            <span><i className="l3" />All graduated</span>
          </div>
        </div>
        {!MAPIN_LAUNCHPAD ? <Notice tone="warn" title="Launches open shortly">The launchpad contract is being upgraded. The map works; launching and trading switch on as soon as the new contract is live.</Notice> : null}
        {state.error ? <Notice tone="error" title="Could not read the chain">{(state.error as Error).message.slice(0, 200)}</Notice> : null}
      </section>

      {/* ---------------------------------------------------------------- slogan band */}
      <section className="mp-band">
        <div>
          <p className="mp-eyebrow">mapin</p>
          <h2>The world map is the order book.</h2>
          <p className="mp-sub">244 countries, 151 currency coins, one contract on Robinhood Chain. Whoever launches first on a currency earns from every trade that routes through it.</p>
        </div>
        <div className="mp-band-cta">
          <Link className="btn btn-yellow btn-lg" href="/tokens">See every token</Link>
          <Link className="btn btn-lg" href="/how-it-works">How it works</Link>
        </div>
      </section>
    </div>
  );
}
