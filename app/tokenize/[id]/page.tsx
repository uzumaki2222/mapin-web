import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getPlaceById, toPlace } from "@/lib/database/queries";
import { TokenizeWizard } from "@/components/create/TokenizeWizard";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

async function load(params: Params) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return null;
  const row = await getPlaceById(id.data);
  return row && !row.hidden ? toPlace(row) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load(params).catch(() => null);
  return { title: p ? `Tokenize ${p.name}` : "Tokenize", robots: { index: false } };
}

export default async function TokenizePage({ params }: { params: Params }) {
  const place = await load(params);
  if (!place) notFound();
  return <TokenizeWizard place={place} />;
}
