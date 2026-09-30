import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarketBySlug } from "@/lib/database/queries";
import { MarketView } from "@/components/market/MarketView";
import { isValidSlug } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

async function load(params: Params) {
  const slug = decodeURIComponent((await params).slug).toLowerCase();
  return isValidSlug(slug) ? getMarketBySlug(slug) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const m = await load(params).catch(() => null);
  if (!m || m.hidden) return { title: "Not found" };
  const where = [m.city, m.country].filter(Boolean).join(", ");
  return {
    title: `${m.businessName} ($${m.symbol})`,
    description: `Community market for ${m.businessName}${where ? ` in ${where}` : ""} on Robinhood Chain.${m.claimed ? "" : " Unofficial — not affiliated with the business."}`,
  };
}

export default async function BusinessMarketPage({ params }: { params: Params }) {
  const m = await load(params);
  if (!m) notFound();
  if (m.hidden) {
    return (
      <div className="container section">
        <h1 style={{ fontSize: "1.8rem" }}>This page has been removed</h1>
        <p className="muted">It was hidden at the request of the business. The token still exists on Robinhood Chain ({m.tokenAddress}), but mapin no longer lists it.</p>
      </div>
    );
  }
  return <MarketView m={m} />;
}
