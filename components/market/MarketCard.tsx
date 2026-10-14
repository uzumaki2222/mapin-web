import Link from "next/link";
import type { MarketSummary } from "@/lib/market/types";
import { FlashValue } from "@/components/ui/FlashValue";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { BondingProgress } from "@/components/ui/ProgressBar";
import { fmtPrice, fmtProgress, fmtQuote, fmtWad } from "@/lib/format";
import { marketPath } from "@/lib/validation/normalize";

export function MarketCard({ m }: { m: MarketSummary }) {
  return (
    <Link href={marketPath(m.slug)} className="market-card" data-testid="market-card">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <TokenLogo src={m.imageUrl} symbol={m.symbol} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ flexWrap: "nowrap" }}>
            <strong className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.businessName}</strong>
            <span className="badge badge-black">${m.symbol}</span>
          </div>
          <div className="small muted mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[m.category, m.city, m.country].filter(Boolean).join(" · ")}{m.claimed ? " · ✓ claimed" : ""}
          </div>
        </div>
      </div>
      <dl className="kv">
        <dt>Price</dt>
        <dd><FlashValue value={m.priceWad ?? ""}>{fmtPrice(m.priceWad, m.quoteSymbol)}</FlashValue></dd>
        <dt>Market cap</dt>
        <dd><FlashValue value={m.marketCapWad ?? ""}>{fmtWad(m.marketCapWad, m.quoteSymbol)}</FlashValue></dd>
        <dt>24h volume</dt>
        <dd><FlashValue value={m.volume24h}>{fmtQuote(m.volume24h, m.quoteDecimals, m.quoteSymbol)}</FlashValue></dd>
        <dt>Pair</dt>
        <dd>{m.symbol}/{m.quoteSymbol}</dd>
      </dl>
      <BondingProgress percent={fmtProgress(m.progressWad)} graduated={m.status === "graduated"} />
    </Link>
  );
}
