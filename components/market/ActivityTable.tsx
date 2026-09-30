"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { ActivityItem } from "@/lib/market/types";
import { explorerTx, explorerAddress } from "@/lib/config/public";
import { formatAmount, shortenAddress } from "@/lib/validation/normalize";
import { timeAgo } from "@/lib/format";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";

export function ActivityTable({ slug, symbol, quoteSymbol, quoteDecimals }: { slug: string; symbol: string; quoteSymbol: string; quoteDecimals: number }) {
  const q = useQuery({
    queryKey: ["activity", slug],
    queryFn: () => api<{ items: ActivityItem[] }>(`/api/markets/${encodeURIComponent(slug)}/activity?limit=50`),
    refetchInterval: 15_000,
  });
  if (q.isLoading) return <Spinner label="Loading activity…" />;
  if (q.isError) return <Notice tone="error">{(q.error as Error).message}</Notice>;
  const items = q.data?.items ?? [];
  if (!items.length) return <div className="empty">No indexed activity yet. Trades appear here once the indexer processes them.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Type</th><th>Venue</th><th>Wallet</th><th>{quoteSymbol}</th><th>{symbol}</th><th>Time</th><th>Tx</th></tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const quoteAmt = a.quoteVolume ? `${formatAmount(BigInt(a.quoteVolume), quoteDecimals, 5)}` : "—";
            const tokenRaw = a.type === "buy" ? a.amountOut : a.type === "sell" ? a.amountIn : null;
            return (
              <tr key={`${a.txHash}-${a.type}-${a.timestamp}`}>
                <td className={a.type === "buy" ? "pos" : a.type === "sell" ? "neg" : undefined}>{a.type.toUpperCase()}</td>
                <td>{a.venue === "curve" ? "Curve" : "PancakeSwap"}</td>
                <td>{a.wallet ? <a href={explorerAddress(a.wallet)} target="_blank" rel="noopener noreferrer">{shortenAddress(a.wallet)}</a> : "—"}</td>
                <td>{quoteAmt}</td>
                <td>{tokenRaw ? formatAmount(BigInt(tokenRaw), 18, 2) : "—"}</td>
                <td>{timeAgo(a.timestamp)}</td>
                <td><a href={explorerTx(a.txHash)} target="_blank" rel="noopener noreferrer">{a.txHash.slice(0, 10)}…</a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
