"use client";

import Link from "next/link";
import { useEthUsd, useMapinState } from "@/components/countries/useMapin";
import { Flag, PLACE, Stats, TradeBox, placeOf, timeAgo } from "@/components/countries/shared";
import { explorerAddress, explorerToken } from "@/lib/config/public";
import { Notice } from "@/components/ui/Notice";

export function TokenPage({ address }: { address: string }) {
  const state = useMapinState();
  const ethUsd = useEthUsd().data ?? null;
  const token = state.data?.byAddress.get(address.toLowerCase());

  if (state.isLoading && !state.data) {
    return <div className="mp mp-page"><div className="mp-empty">Reading Robinhood Chain…</div></div>;
  }
  if (!token) {
    return (
      <div className="mp mp-page">
        <Link href="/tokens" className="mp-back">← All tokens</Link>
        <Notice tone="error" title="Token not found">This address is not a mapin token, or it was launched seconds ago. Refresh in a moment.</Notice>
      </div>
    );
  }

  const place = placeOf(token);
  const isCountry = token.kind === 2;
  const currency = place ? state.data?.currencies.get(place.currency) : undefined;
  const quoteSym = isCountry ? `$${currency?.symbol ?? place?.currency ?? "?"}` : "ETH";
  const country = isCountry ? PLACE.get(token.key) : null;

  return (
    <div className="mp mp-page">
      <Link href={place ? `/c/${place.id}` : "/tokens"} className="mp-back">← {place ? place.name : "All tokens"}</Link>
      <header className="mp-country">
        {place ? <Flag id={place.id} size={96} className="mp-bigflag" /> : null}
        <div className="mp-country-copy">
          <p className="mp-eyebrow">{isCountry ? `Token on ${country?.name ?? token.key}` : `Currency coin · ${token.key}`} · launched {timeAgo(token.createdAt)}</p>
          <h1>${token.symbol}</h1>
          <div className="mp-pairline">
            <span className="mp-pill on">{token.name}</span>
            <span className="mp-slash">/</span>
            <span className="mp-pill on">{quoteSym}</span>
            {isCountry ? <><span className="mp-slash">/</span><span className="mp-pill on">ETH</span></> : null}
          </div>
          <p className="mp-fine">Creator <a href={explorerAddress(token.creator)} target="_blank" rel="noreferrer" className="mono">{token.creator.slice(0, 6)}…{token.creator.slice(-4)}</a> · creator fee {(token.creatorFeeBps / 100).toFixed(2)}% + 1% platform</p>
        </div>
      </header>
      <div className="mp-cols">
        <section className="mp-card">
          <div className="mp-card-head"><div><h2>Trade ${token.symbol}</h2><p>{isCountry ? `Pay with ETH (routed through ${quoteSym}) or with ${quoteSym} directly.` : "Buy and sell against ETH."}</p></div></div>
          <TradeBox token={token} currency={isCountry ? currency : undefined} />
        </section>
        <section className="mp-card">
          <div className="mp-card-head"><div><h2>Stats</h2><p>Live from the contract, refreshed every few seconds.</p></div></div>
          {place ? <Stats token={token} currency={isCountry ? currency : undefined} place={place} ethUsd={ethUsd} /> : null}
          <div className="mp-verify">
            <span className="mp-k">Verify the pair on-chain</span>
            <div className="mp-verify-pair">
              <b>{token.symbol}</b><em>/</em><b>{isCountry ? currency?.symbol ?? place?.currency : "ETH"}</b>
            </div>
            <p className="mp-fine">
              {isCountry
                ? `This token's contract stores its pair forever: quoteToken() returns the ${currency?.symbol ?? place?.currency} coin address below. It cannot be changed.`
                : "Currency coins trade against ETH (held as WETH inside the launchpad)."}
            </p>
            <a className="mp-linkrow" href={`${explorerAddress(token.address)}?tab=read_contract`} target="_blank" rel="noreferrer">
              ${token.symbol} contract · read quoteToken() <span className="mono">{token.address.slice(0, 8)}…{token.address.slice(-6)}</span> ↗
            </a>
            <a className="mp-linkrow" href={explorerToken(token.quote)} target="_blank" rel="noreferrer">
              Quote: {isCountry ? `$${currency?.symbol ?? place?.currency} coin` : "WETH"} <span className="mono">{token.quote.slice(0, 8)}…{token.quote.slice(-6)}</span> ↗
            </a>
            {isCountry && currency ? (
              <Link className="mp-linkrow" href={`/t/${currency.address}`}>Trade the quote coin: <b>${currency.symbol}</b> ({currency.name}) →</Link>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
