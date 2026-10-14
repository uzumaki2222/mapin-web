import { NextResponse } from "next/server";
import { z } from "zod";
import { getBusinessById, toBusiness } from "@/lib/database/queries";
import { handle, notFound } from "@/lib/errors/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("businesses/[id]", async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) throw notFound("Business not found.");
    const row = await getBusinessById(id.data);
    if (!row) throw notFound("Business not found.");
    return NextResponse.json(toBusiness(row), { headers: { "Cache-Control": "no-store" } });
  });
}
