import type { Metadata } from "next";
import places from "@/lib/countries/places.json";
import { CountryPage } from "@/components/countries/CountryPage";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const p = (places as { id: string; name: string; currency: string }[]).find((x) => x.id === id.toUpperCase());
  return p ? { title: `${p.name} · ${p.currency}`, description: `Launch and trade the ${p.name} coin, paired with the ${p.currency} coin, on Robinhood Chain.` } : { title: "Country" };
}

export default async function Page({ params }: Params) {
  const { id } = await params;
  return <CountryPage id={decodeURIComponent(id).toUpperCase()} />;
}
