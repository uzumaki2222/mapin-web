import "server-only";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/database/pool";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { requireSessionSecret, serverEnv } from "@/lib/config/server";
import { unauthorized } from "@/lib/errors/api";
import type { Address } from "@/lib/contracts/constants";

const COOKIE = "mapin_session";
const TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionRow {
  id: string;
  wallet_address: Address | null;
  wallet_verified_at: Date | null;
  expires_at: Date;
}

function secureCookie(): boolean {
  return serverEnv().NEXT_PUBLIC_APP_URL.startsWith("https://");
}

export async function getSession(): Promise<SessionRow | null> {
  requireSessionSecret();
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  return queryOne<SessionRow>(`SELECT * FROM sessions WHERE id = $1 AND expires_at > now()`, [sha256Hex(raw)]);
}

/** Returns the current session or creates a new anonymous one (sets the cookie). Route handlers only. */
export async function getOrCreateSession(): Promise<SessionRow> {
  const existing = await getSession();
  if (existing) return existing;
  const raw = randomToken(32);
  const id = sha256Hex(raw);
  const row = await queryOne<SessionRow>(
    `INSERT INTO sessions (id, expires_at) VALUES ($1, now() + make_interval(secs => $2)) RETURNING *`,
    [id, TTL_SECONDS],
  );
  const jar = await cookies();
  jar.set(COOKIE, raw, { httpOnly: true, sameSite: "lax", secure: secureCookie(), path: "/", maxAge: TTL_SECONDS });
  if (Math.random() < 0.05) void query(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => undefined);
  return row!;
}

export async function updateSession(id: string, fields: Partial<Omit<SessionRow, "id">>): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await query(`UPDATE sessions SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) await query(`DELETE FROM sessions WHERE id = $1`, [sha256Hex(raw)]);
  jar.delete(COOKIE);
}

/** Session with a SIWE-verified wallet, or 401. */
export async function requireWalletSession(): Promise<SessionRow & { wallet_address: Address }> {
  const s = await getSession();
  if (!s?.wallet_address) throw unauthorized("Sign in with your wallet to continue.");
  return s as SessionRow & { wallet_address: Address };
}

