// Long-running indexer:  npm run indexer        (Ctrl+C to stop; safe to restart any time)
// Single pass:           npm run indexer:once
import "./load-env";
import { indexerPublicClient, serverPublicClient } from "@/lib/chain/server-client";
import { runIndexerPass, refreshMarketStats } from "@/lib/indexer/run";
import { db } from "@/lib/database/pool";

const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => { stopping = true; console.log("\nstopping after current pass…"); });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const client = indexerPublicClient();
  let lastStats = 0;
  do {
    try {
      const r = await runIndexerPass(client);
      if (r.skipped) console.log(`[indexer] skipped: ${r.skipped}`);
      else if (r.from !== null) console.log(`[indexer] blocks ${r.from}–${r.to} (head ${r.head}) +${r.inserted} rows${r.reorgRewoundTo ? `, reorg → ${r.reorgRewoundTo}` : ""}`);
      if (Date.now() - lastStats > 15_000 || once) {
        const n = await refreshMarketStats(serverPublicClient(), 50);
        if (n) console.log(`[indexer] refreshed stats for ${n} market(s)`);
        lastStats = Date.now();
      }
      if (r.caughtUp || r.skipped) await sleep(3_000);
    } catch (err) {
      console.error("[indexer] pass failed (will retry):", err instanceof Error ? err.message : err);
      await sleep(10_000);
    }
  } while (!once && !stopping);
  await db().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
