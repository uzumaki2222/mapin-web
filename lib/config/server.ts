import "server-only";
import { z } from "zod";

// Server configuration is parsed lazily so that missing optional integrations disable
// only the features that need them (the UI reads /api/health to know what is available).

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

const schema = z.object({
  // Falls back to the Vercel production domain, then localhost.
  NEXT_PUBLIC_APP_URL: z.preprocess(
    (v) => emptyToUndefined(v) ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
    z.url().default("http://localhost:3000"),
  ),
  SESSION_SECRET: optionalString,
  DATABASE_URL: optionalString,
  DATABASE_SSL: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("false")),
  /** Bearer token for the /admin page and /api/admin/* (reports, hiding). 24+ characters. */
  ADMIN_TOKEN: optionalString,
  /** Place search and area lookup (OpenStreetMap Nominatim). */
  NOMINATIM_URL: z.preprocess(emptyToUndefined, z.url().default("https://nominatim.openstreetmap.org")),
  /** Contact e-mail sent in the User-Agent to OpenStreetMap services (their usage policy asks for it). */
  OSM_CONTACT_EMAIL: optionalString,
  RPC_URL: z.preprocess(emptyToUndefined, z.url().default("https://bsc-dataseed.bnbchain.org")),
  INDEXER_RPC_URL: optionalUrl,
  INDEXER_START_BLOCK: z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional()),
  INDEXER_SECRET: optionalString,
  METADATA_UPLOAD_URL: optionalUrl,
  IPFS_GATEWAY_URL: z.preprocess(emptyToUndefined, z.url().default("https://flap.mypinata.cloud/ipfs/")),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid server configuration — ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface FeatureFlags {
  database: boolean;
  sessions: boolean;
  admin: boolean;
  metadata: boolean;
  indexer: boolean;
}

export function features(): FeatureFlags {
  const env = serverEnv();
  const database = Boolean(env.DATABASE_URL);
  const sessions = database && Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
  return {
    database,
    sessions,
    admin: database && Boolean(env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 24),
    metadata: Boolean(env.METADATA_UPLOAD_URL),
    indexer: database && Boolean(env.INDEXER_RPC_URL),
  };
}

export function appOrigin(): URL {
  return new URL(serverEnv().NEXT_PUBLIC_APP_URL);
}

/**
 * The origin the browser actually used for this request (the site can be reached on several Vercel
 * aliases). Taken from the Host the request was sent to, which a browser cannot forge cross-site.
 */
export function requestOrigin(req: Request): URL {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim();
  if (!host) return appOrigin();
  const proto = (req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0]!.trim();
  try {
    return new URL(`${proto}://${host}`);
  } catch {
    return appOrigin();
  }
}

export function requireDatabaseUrl(): string {
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new ConfigError("DATABASE_URL is not configured. See README → Database.");
  return url;
}

export function requireSessionSecret(): string {
  const s = serverEnv().SESSION_SECRET;
  if (!s || s.length < 32) throw new ConfigError("SESSION_SECRET must be set to at least 32 characters. See README.");
  return s;
}

export function osmUserAgent(): string {
  const env = serverEnv();
  const contact = env.OSM_CONTACT_EMAIL ? ` (${env.OSM_CONTACT_EMAIL})` : "";
  return `mapin/1.0 (+${appOrigin().origin})${contact}`;
}
