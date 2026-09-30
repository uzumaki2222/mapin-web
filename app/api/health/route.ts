import { NextResponse } from "next/server";
import { features } from "@/lib/config/server";
import { handle } from "@/lib/errors/api";
import { BSC_CHAIN_ID, PORTAL_ADDRESS } from "@/lib/contracts/constants";

export const dynamic = "force-dynamic";

/** Which integrations are configured (booleans only — never values). */
export async function GET() {
  return handle("health", async () => NextResponse.json({ ok: true, chainId: BSC_CHAIN_ID, contract: PORTAL_ADDRESS, features: features() }));
}
