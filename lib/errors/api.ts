import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/config/server";
import { ValidationError } from "@/lib/validation/normalize";

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "upstream_failed"
  | "internal";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (m: string, d?: unknown) => new ApiError(400, "bad_request", m, d);
export const unauthorized = (m = "Sign in with your wallet first.") => new ApiError(401, "unauthorized", m);
export const forbidden = (m: string) => new ApiError(403, "forbidden", m);
export const notFound = (m: string) => new ApiError(404, "not_found", m);
export const conflict = (m: string, d?: unknown) => new ApiError(409, "conflict", m, d);

export function errorResponse(err: unknown, route: string): NextResponse {
  if (err instanceof ApiError) {
    if (err.status >= 500) console.error(`[api ${route}] ${err.code}: ${err.message}`, err.details ?? "");
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
    return NextResponse.json({ error: { code: "bad_request", message } }, { status: 400 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: { code: "bad_request", message: err.message } }, { status: 400 });
  }
  if (err instanceof ConfigError) {
    console.error(`[api ${route}] configuration: ${err.message}`);
    return NextResponse.json({ error: { code: "not_configured", message: err.message } }, { status: 503 });
  }
  // Developer diagnostics go to the server log; the client gets a specific but safe message.
  console.error(`[api ${route}] unhandled error`, err);
  const pgCode = (err as { code?: string })?.code;
  if (pgCode === "ECONNREFUSED" || pgCode === "ENOTFOUND" || pgCode === "57P01") {
    return NextResponse.json({ error: { code: "internal", message: "Database is unreachable. Check DATABASE_URL and that PostgreSQL is running." } }, { status: 503 });
  }
  return NextResponse.json({ error: { code: "internal", message: `Server error in ${route}. Check the server log for details.` } }, { status: 500 });
}

/** Wrap a route handler body with consistent error handling. */
export async function handle(route: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err, route);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw badRequest("Expected a JSON body");
  try {
    return await req.json();
  } catch {
    throw badRequest("Malformed JSON body");
  }
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request, appOrigin: URL): void {
  const origin = req.headers.get("origin");
  if (!origin || origin === appOrigin.origin) return;
  // Same site reached through another domain alias (e.g. a second *.vercel.app name): Origin equals the Host.
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim();
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    /* malformed Origin */
  }
  throw forbidden("Cross-origin request rejected");
}
