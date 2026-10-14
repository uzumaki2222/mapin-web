import "server-only";
import { query } from "@/lib/database/pool";
import { ApiError } from "@/lib/errors/api";

/** Best-effort client IP (first X-Forwarded-For hop, as set by the hosting proxy). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Fixed-window limiter stored in Postgres so it holds across instances and restarts.
 * Throws a 429 ApiError when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowSeconds],
  );
  // opportunistic cleanup of old windows
  if (Math.random() < 0.02) {
    void query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => undefined);
  }
  if ((rows[0]?.count ?? 0) > limit) {
    throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
  }
}
