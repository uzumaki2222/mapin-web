"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { MarketDetail } from "@/lib/market/types";
import { useMarketChain } from "@/hooks/useMarketChain";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { BondingProgress } from "@/components/ui/ProgressBar";
import { CopyButton } from "@/components/ui/CopyButton";
import { Notice } from "@/components/ui/Notice";
import { TradePanel } from "@/components/trading/TradePanel";
import { ActivityTable } from "@/components/market/ActivityTable";
import { MiniMap } from "@/components/map/MiniMap";
import { ReportLink } from "@/components/market/ReportLink";
import { explorerAddress, explorerTx, explorerToken } from "@/lib/config/public";
import { fmtDate, fmtPrice, fmtProgress, fmtQuote, fmtWad, timeAgo } from "@/lib/format";
import { formatCompact, shortenAddress } from "@/lib/validation/normalize";
import { marketCapWad } from "@/lib/market/math";
import { progressPercent } from "@/lib/market/state";
import { decodeError } from "@/lib/errors/decode";

const TABS = ["Overview", "Place", "Activity", "Market"] as const;
type Tab = (typeof TABS)[number];

export function MarketView({ m }: { m: MarketDetail }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const token = m.tokenAddress as Address;
  const chain = useMarketChain(token);
  const live = chain.data;
  const chainError = chain.isError ? decodeError(chain.error, "Reading market state").message : null;

  const priceWad = live ? live.lens.price : m.priceWad ? BigInt(m.priceWad) : null;
  const mcap = live ? marketCapWad(live.lens.price, live.totalSupply) : m.marketCapWad ? BigInt(m.marketCapWad) : null;
  const graduated = live ? live.phase === "graduated" : m.status === "graduated";
  const progress = live ? progressPercent(live.lens.progress) : fmtProgress(m.progressWad);
  const feeText = m.buyTaxBps || m.sellTaxBps ? `Buy ${m.buyTaxBps / 100}% · Sell ${m.sellTaxBps / 100}%` : "None";

  return (
    <div className="container section">
      <div className="row" style={{ alignItems: "flex-start", marginBottom: 20 }}>
        <TokenLogo src={m.imageUrl} symbol={m.symbol} large />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: "2rem" }}>{m.placeName}</h1>
            <span className="badge badge-black">${m.symbol}</span>
            <span className={`badge ${graduated ? "badge-green" : "badge-yellow"}`}>{graduated ? "Graduated" : `Bonding ${progress !== null ? progress.toFixed(1) + "%" : ""}`}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {[m.placeType, m.region].filter(Boolean).join(" · ")}
            <span className="muted"> · launched {fmtDate(m.createdAt)}</span>
          </div>
          <div className="row small mono" style={{ marginTop: 8, gap: 8 }}>
            <span className="muted">CA</span>
            <a href={explorerToken(m.tokenAddress)} target="_blank" rel="noopener noreferrer" className="break">{m.tokenAddress}</a>
            <CopyButton value={m.tokenAddress} />
          </div>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat"><div className="panel-title">Price</div><div className="v">{fmtPrice(priceWad, m.quoteSymbol)}</div></div>
        <div className="stat"><div className="panel-title">Market cap</div><div className="v">{fmtWad(mcap, m.quoteSymbol)}</div></div>
        <div className="stat"><div className="panel-title">24h volume</div><div className="v">{fmtQuote(m.volume24h, m.quoteDecimals, m.quoteSymbol)}</div></div>
        <div className="stat"><div className="panel-title">Holders</div><div className="v">{m.holders ?? "—"}</div></div>
      </div>
      {chainError ? <Notice tone="warn" title="Live data unavailable">{chainError} Showing the last indexed values{m.statsUpdatedAt ? ` (${timeAgo(m.statsUpdatedAt)})` : ""}.</Notice> : null}

      <div className="market-layout">
        <div className="stack" style={{ gap: 20 }}>
          <div className="card card-flat"><BondingProgress percent={progress} graduated={graduated} /></div>
          <div>
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
              ))}
            </div>
            <div className="card card-flat" style={{ borderTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {tab === "Overview" ? (
                <div className="stack">
                  <p style={{ whiteSpace: "pre-wrap" }}>{m.description ?? "No description."}</p>
                  <dl className="review">
                    <dt>Place</dt><dd>{m.placeName}</dd>
                    <dt>Token</dt><dd>{m.tokenName} (${m.symbol})</dd>
                    <dt>Creator</dt><dd><a href={explorerAddress(m.creatorWallet)} target="_blank" rel="noopener noreferrer">{m.creatorWallet}</a></dd>
                    <dt>Pair</dt><dd>{m.symbol}/{m.quoteSymbol}</dd>
                    <dt>Creator fees</dt><dd>{feeText}</dd>
                    <dt>Launch date</dt><dd>{fmtDate(m.createdAt)}</dd>
                    <dt>Launch tx</dt><dd><a href={explorerTx(m.launchTx)} target="_blank" rel="noopener noreferrer">{shortenAddress(m.launchTx, 8)}</a></dd>
                  </dl>
                </div>
              ) : null}
              {tab === "Place" ? (
                <div className="stack">
                  <MiniMap lat={m.lat} lng={m.lng} bbox={m.bbox} placeId={m.placeId} label={m.placeName} />
                  <dl className="review">
                    <dt>Name</dt><dd>{m.placeName}</dd>
                    <dt>Type</dt><dd>{m.placeType ?? "Area"}</dd>
                    <dt>Part of</dt><dd>{m.region ?? "—"}</dd>
                    <dt>Center</dt><dd className="mono">{m.lat.toFixed(4)}, {m.lng.toFixed(4)}</dd>
                    <dt>Map data</dt>
                    <dd><a href={`https://www.openstreetmap.org/${m.sourceId}`} target="_blank" rel="noopener noreferrer">OpenStreetMap {m.sourceId} ↗</a></dd>
                  </dl>
                  <div className="row">
                    <a className="btn" href={`/app?place=${m.placeId}`}>Show on the mapin map</a>
                    <ReportLink placeId={m.placeId} />
                  </div>
                </div>
              ) : null}
              {tab === "Activity" ? (
                <ActivityTable slug={m.slug} symbol={m.symbol} quoteSymbol={m.quoteSymbol} quoteDecimals={m.quoteDecimals} />
              ) : null}
              {tab === "Market" ? (
                <dl className="review">
                  <dt>Status</dt><dd>{live ? live.phase : m.status}</dd>
                  <dt>Token contract</dt><dd><a href={explorerToken(m.tokenAddress)} target="_blank" rel="noopener noreferrer">{m.tokenAddress}</a></dd>
                  <dt>Pair asset</dt><dd>{m.quoteSymbol}{m.quoteToken !== "0x0000000000000000000000000000000000000000" ? ` (${m.quoteToken})` : " (native)"}</dd>
                  <dt>Bonding progress</dt><dd>{graduated ? "Complete" : progress !== null ? `${progress.toFixed(2)}%` : "—"}</dd>
                  <dt>Curve reserve</dt><dd>{live ? fmtQuote(live.lens.reserve, m.quoteDecimals, m.quoteSymbol) : "—"}</dd>
                  <dt>Circulating supply</dt><dd>{live ? `${formatCompact(live.lens.circulatingSupply, 18)} ${m.symbol}` : "—"}</dd>
                  <dt>Total supply</dt><dd>{live ? `${formatCompact(live.totalSupply, 18)} ${m.symbol}` : "—"}</dd>
                  <dt>Graduation at</dt><dd>{live ? `${formatCompact(live.lens.dexSupplyThresh, 18)} ${m.symbol} circulating` : "—"}</dd>
                  <dt>DEX pool</dt>
                  <dd>
                    {live?.pool ? (
                      <><a href={explorerAddress(live.pool.pool)} target="_blank" rel="noopener noreferrer">{live.pool.pool}</a> · verified PancakeSwap v2 pair</>
                    ) : graduated ? "Pool not verified yet" : "Created at graduation"}
                  </dd>
                  <dt>All-time volume</dt><dd>{fmtQuote(m.volumeAll, m.quoteDecimals, m.quoteSymbol)}</dd>
                </dl>
              ) : null}
            </div>
          </div>
        </div>
        <TradePanel
          token={token}
          symbol={m.symbol}
          quote={{ address: m.quoteToken as Address, symbol: m.quoteSymbol, decimals: m.quoteDecimals }}
          chain={live}
          chainError={chainError}
        />
      </div>
    </div>
  );
}
