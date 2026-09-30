import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { requireDatabaseUrl, serverEnv } from "@/lib/config/server";

const g = globalThis as unknown as { __cmPgPool?: Pool };

export function db(): Pool {
  if (!g.__cmPgPool) {
    g.__cmPgPool = new Pool({
      connectionString: requireDatabaseUrl(),
      ssl: serverEnv().DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    g.__cmPgPool.on("error", (err) => console.error("[db] idle client error", err));
  }
  return g.__cmPgPool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}
