import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getBusinessById, toBusiness } from "@/lib/database/queries";
import { TokenizeWizard } from "@/components/create/TokenizeWizard";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

async function load(params: Params) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return null;
  const row = await getBusinessById(id.data);
  return row && !row.hidden ? toBusiness(row) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const b = await load(params).catch(() => null);
  return { title: b ? `Tokenize ${b.name}` : "Tokenize", robots: { index: false } };
}

export default async function TokenizePage({ params }: { params: Params }) {
  const business = await load(params);
  if (!business) notFound();
  return <TokenizeWizard business={business} />;
}
