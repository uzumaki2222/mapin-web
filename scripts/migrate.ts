// Applies db/migrations/*.sql in order, once each, inside a transaction per file.
// Usage: npm run db:migrate   (reads DATABASE_URL from the environment or .env.local)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnvFile(join(process.cwd(), ".env.local"));
  loadEnvFile(join(process.cwd(), ".env"));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (add it to .env.local)");
  const client = new Client({ connectionString: url, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await client.query<{ version: string }>(`SELECT version FROM schema_migrations`)).rows.map((r) => r.version));
  for (const f of files) {
    if (done.has(f)) {
      console.log(`✓ ${f} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, f), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [f]);
      await client.query("COMMIT");
      console.log(`✓ ${f} applied`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${f} failed: ${(err as Error).message}`);
    }
  }
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
