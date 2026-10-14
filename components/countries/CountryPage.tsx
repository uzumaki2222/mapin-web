"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEthUsd, useMapinState } from "@/components/countries/useMapin";
import { Flag, LaunchForm, PLACE, PLACES, Stats, TokenCard, TradeBox, num, titleCase } from "@/components/countries/shared";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { Notice } from "@/components/ui/Notice";

export function CountryPage({ id }: { id: string }) {
  const router = useRouter();
  const place = PLACE.get(id);
  const state = useMapinState();
  const ethUsd = useEthUsd().data ?? null;
  const [showCurrencyTrade, setShowCurrencyTrade] = useState(false);

  if (!place) {
    return (
      <div className="mp mp-page">
        <Link href="/#map" className="mp-back">← Back to the map</Link>
        <Notice tone="error" title="Unknown country">There is no country with code “{id}”.</Notice>
      </div>
    );
  }

  const currency = state.data?.currencies.get(place.currency);
  const tokens = state.data?.byPlace.get(place.id) ?? [];
  const siblings = PLACES.filter((p) => p.currency === place.currency && p.id !== place.id);
  const loading = state.isLoading && !state.data;

  return (
    <div className="mp mp-page">
      <Link href="/#map" className="mp-back">← Back to the map</Link>

      <header className="mp-country">
        <Flag id={place.id} size={96} className="mp-bigflag" />
        <div className="mp-country-copy">
          <p className="mp-eyebrow">{place.currencyName} · {place.currency}{place.currencySymbol ? ` · ${place.currencySymbol}` : ""}</p>
          <h1>{place.name}</h1>
          <div className="mp-pairline">
            <span className="mp-pill">$YOUR&nbsp;TOKEN</span>
            <span className="mp-slash">/</span>
            <span className={`mp-pill ${currency ? "on" : ""}`}>${currency?.symbol ?? place.currency}</span>
            <span className="mp-slash">/</span>
            <span className="mp-pill on">ETH</span>
          </div>
          <p className="mp-fine">Every token launched on {place.name} is paired with the {place.currency} coin. {tokens.length ? `${tokens.length} live here.` : "None yet: be the first."}</p>
        </div>
      </header>

      {!MAPIN_LAUNCHPAD ? <Notice tone="warn" title="Launches open shortly">The launchpad contract is being upgraded. Launching and trading switch on as soon as the new contract is live.</Notice> : null}
      {state.error ? <Notice tone="error" title="Could not read the chain">{(state.error as Error).message.slice(0, 200)}</Notice> : null}

      <div className="mp-cols">
        {/* ---------------- launch */}
        <section className="mp-card mp-card-hot">
          <div className="mp-card-head">
            <span className="mp-step">+</span>
            <div>
              <h2>Launch a token on {place.name}</h2>
              <p>Pick any name and ticker. It pairs with ${currency?.symbol ?? place.currency} automatically.</p>
            </div>
          </div>
          <LaunchForm kind="country" place={place} currencyLive={Boolean(currency)} onDone={(t) => t && router.push(`/t/${t}`)} />
        </section>

        {/* ---------------- currency coin */}
        <section className="mp-card">
          <div className="mp-card-head">
            <span className="mp-step">$</span>
            <div>
              <h2>${currency?.symbol ?? place.currency} <small>/ ETH</small></h2>
              <p>{titleCase(place.currencyName)} coin{siblings.length ? ` · shared by ${siblings.length + 1} countries` : ""}</p>
            </div>
            {currency ? <span className="mp-badge on">Live</span> : <span className="mp-badge">Not launched</span>}
          </div>
          {currency ? (
            <>
              <Stats token={currency} place={place} ethUsd={ethUsd} />
              {showCurrencyTrade ? <TradeBox token={currency} /> : <button type="button" className="btn btn-block" onClick={() => setShowCurrencyTrade(true)}>Trade ${currency.symbol}</button>}
            </>
          ) : (
            <p className="mp-note">The {place.currency} coin is created automatically with the first token launched on any {place.currency} country. Its creator earns a fee on every trade routed through it.</p>
          )}
          <p className="mp-fine">A community coin themed on {place.currencyName}. Not a stablecoin and not pegged to the real currency. 1 USD ≈ {num(place.perUsd)} {place.currency} (reference only).</p>
        </section>
      </div>

      <section className="mp-section">
        <div className="mp-section-head">
          <div>
            <p className="mp-eyebrow">Tokens on {place.name}</p>
            <h2>{tokens.length ? `${tokens.length} token${tokens.length > 1 ? "s" : ""}, newest first` : "No tokens yet"}</h2>
          </div>
        </div>
        {loading ? <div className="mp-empty">Reading Robinhood Chain…</div> : tokens.length ? (
          <div className="mp-tgrid">
            {tokens.map((t) => <TokenCard key={t.address} token={t} quoteSymbol={`$${currency?.symbol ?? place.currency}`} ethUsd={ethUsd} />)}
          </div>
        ) : (
          <div className="mp-empty"><b>{place.name} is wide open.</b> Launch the first token above and it shows up here and on the map.</div>
        )}
      </section>

      {siblings.length ? (
        <section className="mp-section mp-siblings">
          <p className="mp-eyebrow">Also paired with ${currency?.symbol ?? place.currency}</p>
          <div className="mp-sib-list">
            {siblings.slice(0, 30).map((p) => (
              <Link key={p.id} href={`/c/${p.id}`} className="mp-tile"><Flag id={p.id} size={22} /><b>{p.name}</b></Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
