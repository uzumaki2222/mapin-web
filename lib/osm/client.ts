import "server-only";
import { osmUserAgent, serverEnv } from "@/lib/config/server";
import { ApiError } from "@/lib/errors/api";
import type { AreaLevel, PlaceCandidate, SearchResult } from "@/lib/market/types";
import {
  LEVEL_ZOOM,
  levelChoices,
  lookupIdOf,
  nominatimToResult,
  resultToPlace,
  type LevelChoice,
  type NominatimResult,
} from "@/lib/osm/parse";

// Small in-memory cache per server instance: OpenStreetMap's public servers ask clients to cache
// and to keep request rates low. Everything is requested in English.
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 30 * 60_000;

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

// The public Nominatim server allows at most 1 request per second per application: requests from this
// instance are queued so they are never sent faster than that (cached answers skip the queue).
let queue: Promise<unknown> = Promise.resolve();
let lastSent = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastSent + 1_100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSent = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(path, serverEnv().NOMINATIM_URL);
  for (const [k, v] of Object.entries({ format: "jsonv2", "accept-language": "en", ...params })) u.searchParams.set(k, v);
  return cached(u.toString(), () => throttled(async () => {
    let res: Response;
    try {
      res = await fetch(u, {
        headers: { "User-Agent": osmUserAgent(), Accept: "application/json", "Accept-Language": "en" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new ApiError(502, "upstream_failed", "The map data service did not respond. Try again in a moment.", String(err));
    }
    if (res.status === 429 || res.status === 503) {
      throw new ApiError(503, "upstream_failed", "The map data service is busy right now. Try again in a few seconds.");
    }
    if (!res.ok) throw new ApiError(502, "upstream_failed", `The map data service answered ${res.status}.`);
    return (await res.json()) as T;
  }));
}

/** Search any place on earth by name (countries, states, cities, towns, villages, neighbourhoods …). */
export async function searchPlaces(q: string): Promise<SearchResult[]> {
  const query = q.trim().slice(0, 120);
  if (query.length < 2) return [];
  const rows = await nominatim<NominatimResult[]>("/search", {
    q: query,
    addressdetails: "1",
    namedetails: "1",
    limit: "10",
    layer: "address",
  });
  return rows.map(nominatimToResult).filter((r): r is SearchResult => r !== null);
}

export interface AreaAtPoint {
  place: PlaceCandidate | null;
  /** larger / smaller areas that contain the point, for the level switcher */
  levels: LevelChoice[];
}

/** The area at a map point, at the given level (country, state, city …). */
export async function areaAt(lat: number, lng: number, level: AreaLevel): Promise<AreaAtPoint> {
  const r = await nominatim<NominatimResult>("/reverse", {
    lat: lat.toFixed(5),
    lon: lng.toFixed(5),
    zoom: String(LEVEL_ZOOM[level]),
    addressdetails: "1",
    namedetails: "1",
    layer: "address",
  });
  if (r.error) return { place: null, levels: [] };
  return { place: resultToPlace(r), levels: levelChoices(r.address) };
}

/** Authoritative details for one OpenStreetMap element ("relation/175905"). */
export async function lookupPlace(sourceId: string): Promise<PlaceCandidate | null> {
  const id = lookupIdOf(sourceId);
  if (!id) return null;
  const rows = await nominatim<NominatimResult[]>("/lookup", { osm_ids: id, addressdetails: "1", namedetails: "1" });
  return rows[0] ? resultToPlace(rows[0]) : null;
}

/** Simplified outline (GeoJSON geometry) of a place, for drawing its border on the map. */
export async function placeOutline(sourceId: string): Promise<unknown | null> {
  const id = lookupIdOf(sourceId);
  if (!id) return null;
  const rows = await nominatim<NominatimResult[]>("/lookup", { osm_ids: id, polygon_geojson: "1", polygon_threshold: "0.005" });
  return rows[0]?.geojson ?? null;
}
