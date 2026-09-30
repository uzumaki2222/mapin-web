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
import { explorerAddress, explorerTx, explorerToken } from "@/lib/config/public";
import { fmtDate, fmtPrice, fmtProgress, fmtQuote, fmtWad, safeHttpUrl, timeAgo } from "@/lib/format";
import { formatAmount, formatCompact, shortenAddress } from "@/lib/validation/normalize";
import { marketCapWad } from "@/lib/market/math";
import { progressPercent } from "@/lib/market/state";
import { decodeError } from "@/lib/errors/decode";
import { MiniMap } from "@/components/map/MiniMap";
import { OwnerCard } from "@/components/market/OwnerCard";

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
  const graduating = live?.phase === "staged";
  const progress = live ? progressPercent(live.lens.progress) : fmtProgress(m.progressWad);

  return (
    <div className="container section">
      <div className="row" style={{ alignItems: "flex-start", marginBottom: 20 }}>
        <TokenLogo src={m.imageUrl} symbol={m.symbol} large />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: "2rem" }}>{m.businessName}</h1>
            <span className="badge badge-black">${m.symbol}</span>
            <span className={`badge ${graduated ? "badge-green" : "badge-yellow"}`}>{graduated ? "Graduated" : graduating ? "Graduating" : `Bonding ${progress !== null ? progress.toFixed(1) + "%" : ""}`}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            <span>{[m.category, m.address, m.city, m.country].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <span className={`badge ${m.claimed ? "badge-green" : ""}`}>{m.claimed ? "✓ Claimed by the owner" : "Unofficial · not affiliated with the business"}</span>
            <span className="small muted">tokenized {fmtDate(m.createdAt)}</span>
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
                    <dt>Business</dt><dd>{m.businessName}</dd>
                    <dt>Token</dt><dd>{m.tokenName} (${m.symbol})</dd>
                    <dt>Tokenized by</dt><dd><a href={explorerAddress(m.creatorWallet)} target="_blank" rel="noopener noreferrer">{m.creatorWallet}</a></dd>
                    <dt>Pair</dt><dd>{m.symbol}/{m.quoteSymbol}</dd>
                    <dt>Owner share</dt><dd>{m.buyTaxBps ? `${m.buyTaxBps / 100}% of every trade` : "None"} → {m.claimed ? "the verified owner" : "held in escrow until the owner claims"}</dd>
                    <dt>Launch date</dt><dd>{fmtDate(m.createdAt)}</dd>
                    <dt>Launch tx</dt><dd><a href={explorerTx(m.launchTx)} target="_blank" rel="noopener noreferrer">{shortenAddress(m.launchTx, 8)}</a></dd>
                  </dl>
                </div>
              ) : null}
              {tab === "Place" ? (
                <div className="stack">
                  <MiniMap lat={m.lat} lng={m.lng} label={m.businessName} />
                  <dl className="review">
                    <dt>Address</dt><dd>{[m.address, m.city, m.country].filter(Boolean).join(", ") || "—"}</dd>
                    <dt>Category</dt><dd>{m.category ?? "—"}</dd>
                    <dt>Coordinates</dt><dd className="mono">{m.lat.toFixed(5)}, {m.lng.toFixed(5)}</dd>
                    {safeHttpUrl(m.website) ? (<><dt>Website</dt><dd><a href={safeHttpUrl(m.website)!} target="_blank" rel="noopener noreferrer nofollow">{m.website}</a></dd></>) : null}
                    <dt>Map data</dt>
                    <dd>
                      {m.source === "osm" ? (
                        <a href={`https://www.openstreetmap.org/${m.sourceId}`} target="_blank" rel="noopener noreferrer">OpenStreetMap {m.sourceId} ↗</a>
                      ) : "Added to the map by the community"}
                    </dd>
                  </dl>
                  <div className="row">
                    <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`} target="_blank" rel="noopener noreferrer">Directions ↗</a>
                    <a className="btn" href={`/?place=${m.businessId}`}>Show on the mapin map</a>
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
                  <dt>Graduation at</dt><dd>{live ? `${formatAmount(live.lens.graduationThreshold, m.quoteDecimals, 4)} ${m.quoteSymbol} raised` : "—"}</dd>
                  <dt>Bonding curve</dt><dd>{live?.lens.curve ? <a href={explorerAddress(live.lens.curve)} target="_blank" rel="noopener noreferrer">{live.lens.curve}</a> : "—"}</dd>
                  <dt>DEX pool</dt>
                  <dd>
                    {live?.pool ? (
                      <><span className="mono break">{live.pool.poolId}</span> · verified Uniswap v4 pool (liquidity locked)</>
                    ) : graduated ? "Pool not verified yet" : "Created at graduation (Uniswap v4)"}
                  </dd>
                  <dt>All-time volume</dt><dd>{fmtQuote(m.volumeAll, m.quoteDecimals, m.quoteSymbol)}</dd>
                </dl>
              ) : null}
            </div>
          </div>
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <TradePanel
            token={token}
            symbol={m.symbol}
            quote={{ address: m.quoteToken as Address, symbol: m.quoteSymbol, decimals: m.quoteDecimals }}
            chain={live}
            chainError={chainError}
          />
          <OwnerCard m={m} />
        </div>
      </div>
    </div>
  );
}
