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
  return {
    title: `${m.placeName} ($${m.symbol})`,
    description: `The community token of ${m.placeName}${m.region ? `, ${m.region}` : ""} on BNB Smart Chain.`,
  };
}

export default async function PlaceMarketPage({ params }: { params: Params }) {
  const m = await load(params);
  if (!m) notFound();
  if (m.hidden) {
    return (
      <div className="container section">
        <h1 style={{ fontSize: "1.8rem" }}>This page has been removed</h1>
        <p className="muted">The token still exists on BNB Smart Chain ({m.tokenAddress}), but mapin no longer lists it.</p>
      </div>
    );
  }
  return <MarketView m={m} />;
}
