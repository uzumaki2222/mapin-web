"use client";

import Link from "next/link";
import { useEthUsd, useMapinState } from "@/components/countries/useMapin";
import { Flag, LaunchForm, PLACE, PLACES, Stats, TradeBox, num, tickerFor, titleCase } from "@/components/countries/shared";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { Notice } from "@/components/ui/Notice";

export function CountryPage({ id }: { id: string }) {
  const place = PLACE.get(id);
  const state = useMapinState();
  const ethUsd = useEthUsd().data ?? null;

  if (!place) {
    return (
      <div className="mp mp-page">
        <Link href="/#map" className="mp-back">← Back to the map</Link>
        <Notice tone="error" title="Unknown country">There is no country with code “{id}”.</Notice>
      </div>
    );
  }

  const currency = state.data?.currencies.get(place.currency);
  const country = state.data?.countries.get(place.id);
  const siblings = PLACES.filter((p) => p.currency === place.currency && p.id !== place.id);
  const curTicker = currency?.symbol ?? place.currency;
  const ctyTicker = country?.symbol ?? tickerFor(place.name);
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
            <span className={`mp-pill ${country ? "on" : ""}`}>${ctyTicker}</span>
            <span className="mp-slash">/</span>
            <span className={`mp-pill ${currency ? "on" : ""}`}>${curTicker}</span>
            <span className="mp-slash">/</span>
            <span className="mp-pill on">ETH</span>
          </div>
          <p className="mp-fine">1 USD ≈ {num(place.perUsd)} {place.currency} (reference rate, display only)</p>
        </div>
      </header>

      {!MAPIN_LAUNCHPAD ? <Notice tone="error" title="Contract not set">The launchpad address is missing from this deployment.</Notice> : null}
      {state.error ? <Notice tone="error" title="Could not read the chain">{(state.error as Error).message.slice(0, 200)}</Notice> : null}

      {loading ? <div className="mp-empty">Reading Robinhood Chain…</div> : (
        <div className="mp-cols">
          {/* ---------------- step 1: currency coin */}
          <section className={`mp-card ${currency ? "" : "mp-card-hot"}`}>
            <div className="mp-card-head">
              <span className="mp-step">1</span>
              <div>
                <h2>${curTicker} <small>/ ETH</small></h2>
                <p>{titleCase(place.currencyName)} coin{siblings.length ? ` · shared with ${siblings.length} other ${siblings.length === 1 ? "country" : "countries"}` : ""}</p>
              </div>
              {currency ? <span className="mp-badge on">Live</span> : <span className="mp-badge">Not launched</span>}
            </div>
            {currency ? (
              <>
                <Stats token={currency} place={place} ethUsd={ethUsd} />
                <TradeBox token={currency} />
              </>
            ) : (
              <>
                <p className="mp-note">Nobody has launched the {place.currency} coin yet. Launch it and you earn the creator fee on every ${place.currency} trade, including the trades routed through it by every {place.currency} country.</p>
                <LaunchForm kind="currency" place={place} />
              </>
            )}
            <p className="mp-fine">A community meme coin themed on {place.currencyName}. Not a stablecoin, not pegged to the real currency.</p>
          </section>

          {/* ---------------- step 2: country coin */}
          <section className={`mp-card ${currency && !country ? "mp-card-hot" : ""}`}>
            <div className="mp-card-head">
              <span className="mp-step">2</span>
              <div>
                <h2>${ctyTicker} <small>/ ${curTicker}</small></h2>
                <p>{place.name} coin</p>
              </div>
              {country ? <span className="mp-badge on">{country.graduated ? "Graduated" : "Live"}</span> : <span className="mp-badge">Not launched</span>}
            </div>
            {country ? (
              <>
                <Stats token={country} currency={currency} place={place} ethUsd={ethUsd} />
                <TradeBox token={country} currency={currency} />
              </>
            ) : currency ? (
              <>
                <p className="mp-note">{place.name} has no coin yet. Launch ${ctyTicker} paired with ${curTicker} and earn the creator fee on every trade.</p>
                <LaunchForm kind="country" place={place} />
              </>
            ) : (
              <div className="mp-locked">
                <b>Launch ${place.currency} first</b>
                <p>${ctyTicker} trades against ${place.currency}. As soon as step 1 is live, this unlocks.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {siblings.length ? (
        <section className="mp-section mp-siblings">
          <p className="mp-eyebrow">Also on ${curTicker}</p>
          <div className="mp-sib-list">
            {siblings.slice(0, 24).map((p) => (
              <Link key={p.id} href={`/c/${p.id}`} className="mp-tile"><Flag id={p.id} size={22} /><b>{p.name}</b></Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
