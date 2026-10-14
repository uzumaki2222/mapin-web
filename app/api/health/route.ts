import { NextResponse } from "next/server";
import { features } from "@/lib/config/server";
import { handle } from "@/lib/errors/api";
import { CHAIN_ID, PONS_FACTORY } from "@/lib/contracts/constants";

export const dynamic = "force-dynamic";

/** Which integrations are configured (booleans only — never values). */
export async function GET() {
  return handle("health", async () => NextResponse.json({ ok: true, chainId: CHAIN_ID, contract: PONS_FACTORY, features: features() }));
}
