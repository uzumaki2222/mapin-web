import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession } from "@/lib/auth/session";
import { queryOne } from "@/lib/database/pool";
import { handle, readJson, assertSameOrigin, notFound, ApiError } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { serverPublicClient } from "@/lib/chain/server-client";
import { finalizeLaunch } from "@/lib/market/finalize";
import { rateLimit } from "@/lib/security/rate-limit";
import { normalizeTxHash, marketPath } from "@/lib/validation/normalize";
import type { LaunchIntentRow } from "@/lib/database/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ intentId: z.uuid(), txHash: z.string() });

/** Server-side verification of a mined launch transaction → persists the canonical market. */
export async function POST(req: Request) {
  return handle("markets/confirm", async () => {
    assertSameOrigin(req, appOrigin());
    const session = await requireWalletSession();
    await rateLimit(`confirm:${session.wallet_address}`, 60, 60 * 60);
    const b = body.parse(await readJson(req));
    const hash = normalizeTxHash(b.txHash);
    const intent = await queryOne<LaunchIntentRow>(
      `SELECT * FROM launch_intents WHERE id = $1 AND creator_wallet = $2`,
      [b.intentId, session.wallet_address],
    );
    if (!intent) throw notFound("Launch request not found for this wallet.");

    const client = serverPublicClient();
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, confirmations: 1 });
    } catch (err) {
      throw new ApiError(504, "upstream_failed", "The launch transaction is not confirmed yet. It will be picked up automatically — or retry in a minute.", String(err));
    }
    const done = await finalizeLaunch(client, intent, receipt);
    return NextResponse.json({
      marketId: done.marketId,
      tokenAddress: done.tokenAddress,
      txHash: done.txHash,
      marketPath: marketPath(done.slug),
      alreadyRecorded: done.alreadyRecorded,
    });
  });
}
