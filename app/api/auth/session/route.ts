import { NextResponse } from "next/server";
import { features } from "@/lib/config/server";
import { getSession } from "@/lib/auth/session";
import { handle } from "@/lib/errors/api";
import type { SessionInfo } from "@/lib/market/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("auth/session", async () => {
    const f = features();
    const s = f.sessions ? await getSession() : null;
    const info: SessionInfo = {
      configured: f,
      wallet: s?.wallet_address ?? null,
    };
    return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
  });
}
