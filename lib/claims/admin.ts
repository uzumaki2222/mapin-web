import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/config/server";
import { ApiError } from "@/lib/errors/api";

/** Bearer ADMIN_TOKEN check (constant time). */
export function requireAdmin(req: Request): void {
  const expected = serverEnv().ADMIN_TOKEN;
  if (!expected || expected.length < 24) throw new ApiError(503, "not_configured", "ADMIN_TOKEN is not configured (24+ characters).");
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "unauthorized", "Wrong admin token.");
}
