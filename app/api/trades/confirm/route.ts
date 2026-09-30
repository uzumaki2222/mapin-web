import { NextResponse } from "next/server";
import { z } from "zod";
import { serverPublicClient } from "@/lib/chain/server-client";
import { recordTradesFromReceipt } from "@/lib/trades/record";
import { handle, readJson, assertSameOrigin, ApiError } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { normalizeTxHash } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({ txHash: z.string() });

/** Called by the trade panel after a buy/sell confirms: records it from the on-chain receipt for the live feed. */
export async function POST(req: Request) {
  return handle("trades/confirm", async () => {
    assertSameOrigin(req, appOrigin());
    await rateLimit(`trade-confirm:${clientIp(req)}`, 60, 60);
    const hash = normalizeTxHash(body.parse(await readJson(req)).txHash);
    const client = serverPublicClient();
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 });
    } catch (err) {
      throw new ApiError(504, "upstream_failed", "Transaction not confirmed yet.", String(err));
    }
    const inserted = await recordTradesFromReceipt(client, receipt);
    return NextResponse.json({ inserted });
  });
}
