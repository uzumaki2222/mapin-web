import { formatAmount, formatCompact } from "@/lib/validation/normalize";
import { progressPercent } from "@/lib/market/state";

/** Format an 18-decimal fixed-point quote value (price / market cap) with the quote symbol. */
export function fmtWad(value: string | bigint | null | undefined, symbol: string, compact = true): string {
  if (value === null || value === undefined) return "—";
  const v = typeof value === "string" ? BigInt(value) : value;
  return `${compact ? formatCompact(v, 18) : formatAmount(v, 18, 8)} ${symbol}`;
}

/** Price per token: keep significant digits for tiny prices. */
export function fmtPrice(priceWad: string | bigint | null | undefined, symbol: string): string {
  if (priceWad === null || priceWad === undefined) return "—";
  const v = typeof priceWad === "string" ? BigInt(priceWad) : priceWad;
  if (v === 0n) return `0 ${symbol}`;
  const n = Number(formatAmount(v, 18, 18).replace(/,/g, ""));
  return `${n < 0.0001 ? n.toExponential(3) : n.toPrecision(5)} ${symbol}`;
}

export function fmtQuote(raw: string | bigint | null | undefined, decimals: number, symbol: string): string {
  if (raw === null || raw === undefined) return "—";
  const v = typeof raw === "string" ? BigInt(raw) : raw;
  return `${formatCompact(v, decimals)} ${symbol}`;
}

export function fmtProgress(progressWad: string | null | undefined): number | null {
  return progressWad ? progressPercent(BigInt(progressWad)) : null;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Only http(s) links from user-controlled data (e.g. a business website) are rendered. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
