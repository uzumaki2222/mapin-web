// Pure normalization / parsing helpers. No runtime dependencies so they can be unit-tested
// with Node's built-in test runner and reused on client and server alike.

import type { Address } from "../contracts/constants.ts";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** True if the string is a syntactically valid 20-byte hex address (checksum not enforced). */
export function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value.trim());
}

/** Canonical storage form for addresses: trimmed, lower-case, 0x-prefixed. */
export function normalizeAddress(value: string): Address {
  const v = value.trim();
  if (!ADDRESS_RE.test(v)) throw new ValidationError(`Invalid address: ${value}`);
  return v.toLowerCase() as Address;
}

export function normalizeTxHash(value: string): `0x${string}` {
  const v = value.trim();
  if (!TX_HASH_RE.test(v)) throw new ValidationError(`Invalid transaction hash: ${value}`);
  return v.toLowerCase() as `0x${string}`;
}

export function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function shortenAddress(address: string, chars = 4): string {
  if (!isHexAddress(address)) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

// ---------------------------------------------------------------- places

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 80 && SLUG_RE.test(slug);
}

/** URL-safe ASCII slug of a place name ("Café Ñandú & Co." → "cafe-nandu-co"). */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "place";
}

/** Route path of a place market page. */
export function marketPath(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

/** Suggested ticker from a place name: initials for several words ("New York City" → NYC), else the word (max 10). */
export function suggestTicker(name: string): string {
  const words = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "PLACE";
  if (words.length >= 2) return words.map((w) => w[0]).join("").slice(0, 10);
  return words[0]!.slice(0, 10);
}

/** Bare hostname of a website URL, lower-case, without "www." (null if not a valid http(s) URL). */
export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- token fields

const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

export function normalizeSymbol(input: string): string {
  const s = input.trim().replace(/^\$/, "").toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new ValidationError("Ticker must be 1–10 letters or digits");
  return s;
}

export function normalizeTokenName(input: string): string {
  const s = input.trim().replace(/\s+/g, " ");
  if (s.length < 1 || s.length > 32) throw new ValidationError("Token name must be 1–32 characters");
  // printable characters only; no control chars that could spoof wallets or explorers
  if (/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/.test(s)) {
    throw new ValidationError("Token name contains unsupported characters");
  }
  return s;
}

// ---------------------------------------------------------------- amounts

const DECIMAL_RE = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;

/**
 * Parse a user-entered decimal string into integer base units.
 * Strict: no signs, no exponents, no thousands separators, no more fraction digits than `decimals`.
 */
export function parseAmount(input: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new ValidationError(`Unsupported token decimals: ${decimals}`);
  }
  const s = input.trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new ValidationError("Enter a valid amount");
  const whole = m[1] ?? "0";
  const frac = m[2] ?? m[3] ?? "";
  if (frac.length > decimals) throw new ValidationError(`Too many decimal places (max ${decimals})`);
  const padded = frac.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + (padded ? BigInt(padded) : 0n);
}

/** Format integer base units as a decimal string, trimming trailing zeros. */
export function formatAmount(value: bigint, decimals: number, maxFractionDigits = decimals): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = decimals > 0 ? (v % base).toString().padStart(decimals, "0") : "";
  frac = frac.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeStr}${frac ? "." + frac : ""}`;
}

/** Compact human formatting (1.2K, 3.4M) for large display values given in base units. */
export function formatCompact(value: bigint, decimals: number): string {
  const n = Number(formatAmount(value, decimals, 6).replace(/,/g, ""));
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (abs >= 1) return n.toFixed(2);
  // small numbers: keep 4 significant digits
  return n.toPrecision(4);
}
