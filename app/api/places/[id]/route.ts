import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlaceById, toPlace } from "@/lib/database/queries";
import { handle, notFound } from "@/lib/errors/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("places/[id]", async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw notFound("Place not found.");
    const row = await getPlaceById(id.data);
    if (!row) throw notFound("Place not found.");
    return NextResponse.json(toPlace(row), { headers: { "Cache-Control": "no-store" } });
  });
}
