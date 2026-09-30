import "server-only";
import { features } from "@/lib/config/server";
import { indexerPublicClient, serverPublicClient } from "@/lib/chain/server-client";
import { queryOne } from "@/lib/database/pool";
import { refreshMarketStats, runIndexerPass } from "@/lib/indexer/run";

// Keeps the live feed fresh without a separate worker: the endpoints the site polls call this after
// responding. At most one pass every few seconds across all instances (database timestamp + advisory
// lock inside runIndexerPass), so many visitors never multiply the RPC load.

const MIN_GAP_MS = 6_000;
let lastLocal = 0;
let running = false;

export async function indexIfDue(): Promise<void> {
  if (!features().indexer || running) return;
  const now = Date.now();
  if (now - lastLocal < MIN_GAP_MS) return;
  lastLocal = now;
  running = true;
  try {
    const recent = await queryOne<{ fresh: boolean }>(
      `SELECT updated_at > now() - make_interval(secs => $1) AS fresh FROM indexer_state WHERE name = 'main'`,
      [MIN_GAP_MS / 1000],
    );
    if (recent?.fresh) return;
    const r = await runIndexerPass(indexerPublicClient());
    if (!r.skipped) await refreshMarketStats(serverPublicClient(), 8);
  } catch (err) {
    console.warn("[indexer:auto]", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}
