import "server-only";
import { osmUserAgent, serverEnv } from "@/lib/config/server";
import { ApiError } from "@/lib/errors/api";
import type { PlaceCandidate, SearchResult } from "@/lib/market/types";
import {
  cityOf,
  elementToCandidate,
  nominatimToResult,
  parseSourceId,
  pickClicked,
  type NominatimResult,
  type OverpassElement,
} from "@/lib/osm/parse";

// Small in-memory cache per server instance: OSM services are shared public infrastructure and
// ask clients to cache and to keep request rates low.
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 10 * 60_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2_000) {
    for (const k of [...cache.keys()].slice(0, 500)) cache.delete(k);
  }
  return value;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "User-Agent": osmUserAgent(), Accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiError(502, "upstream_failed", "The map data service did not respond. Try again in a moment.", String(err));
  }
  if (res.status === 429 || res.status === 504) {
    throw new ApiError(503, "upstream_failed", "The map data service is busy right now. Try again in a few seconds.");
  }
  if (!res.ok) throw new ApiError(502, "upstream_failed", `The map data service answered ${res.status}.`);
  return (await res.json()) as T;
}

async function overpass(q: string): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: q });
  const data = await getJson<{ elements?: OverpassElement[] }>(serverEnv().OVERPASS_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data.elements ?? [];
}

/** Search any place on earth: businesses, streets, neighbourhoods, cities, countries. */
export async function searchPlaces(q: string, near: { lat: number; lng: number } | null, lang: string): Promise<SearchResult[]> {
  const query = q.trim().slice(0, 120);
  if (query.length < 2) return [];
  const u = new URL("/search", serverEnv().NOMINATIM_URL);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("extratags", "1");
  u.searchParams.set("limit", "8");
  if (near) {
    // prefer (not restrict to) results around what the user is looking at
    const d = 0.6;
    u.searchParams.set("viewbox", [near.lng - d, near.lat + d, near.lng + d, near.lat - d].map((n) => n.toFixed(4)).join(","));
  }
  const key = `s|${u.search}|${lang}`;
  const rows = await cached(key, () => getJson<NominatimResult[]>(u.toString(), { headers: { "Accept-Language": lang } }));
  return rows.map(nominatimToResult).filter((r): r is SearchResult => r !== null);
}

/** City + country for a coordinate (reverse geocoding at town level). */
export async function reverseArea(lat: number, lng: number): Promise<{ city: string | null; country: string | null; countryCode: string | null }> {
  const u = new URL("/reverse", serverEnv().NOMINATIM_URL);
  u.searchParams.set("lat", lat.toFixed(5));
  u.searchParams.set("lon", lng.toFixed(5));
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("zoom", "10");
  u.searchParams.set("addressdetails", "1");
  try {
    const r = await cached(`r|${u.search}`, () => getJson<NominatimResult>(u.toString(), { headers: { "Accept-Language": "en" } }));
    return {
      city: cityOf(r.address),
      country: r.address?.country ?? null,
      countryCode: r.address?.country_code?.toUpperCase().slice(0, 2) ?? null,
    };
  } catch {
    return { city: null, country: null, countryCode: null };
  }
}

/** Authoritative details for one OSM element ("node/123"). Null when it is not a named business. */
export async function lookupElement(sourceId: string): Promise<PlaceCandidate | null> {
  const ref = parseSourceId(sourceId);
  if (!ref) return null;
  const els = await cached(`e|${sourceId}`, () => overpass(`[out:json][timeout:15];${ref.type}(${ref.id});out center tags;`));
  const el = els.find((e) => e.type === ref.type && String(e.id) === ref.id);
  return el ? elementToCandidate(el) : null;
}

/** The business the user clicked on the map: matched by its label near the click point. */
export async function lookupClicked(lat: number, lng: number, label: string | null): Promise<PlaceCandidate | null> {
  const la = lat.toFixed(6);
  const ln = lng.toFixed(6);
  const els = await cached(`c|${la},${ln}`, () =>
    overpass(`[out:json][timeout:15];nwr(around:60,${la},${ln})["name"];out center tags 60;`),
  );
  return pickClicked(els, lat, lng, label) ?? (label ? null : pickClicked(els, lat, lng, null));
}

/** Fill in city/country when OSM tags do not carry them (most places). */
export async function withArea(p: PlaceCandidate): Promise<PlaceCandidate> {
  if (p.city && p.country) return p;
  const a = await reverseArea(p.lat, p.lng);
  return { ...p, city: p.city ?? a.city, country: p.country ?? a.country, countryCode: p.countryCode ?? a.countryCode };
}
