// Pure OpenStreetMap (Nominatim) parsing: search / reverse / lookup results → mapin places.
// No I/O here so it can be unit tested.

import type { AreaLevel, BBox, PlaceCandidate, SearchResult } from "../market/types.ts";

export interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  place_rank?: number;
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
  address?: Record<string, string>;
  namedetails?: Record<string, string> | null;
  geojson?: unknown;
  error?: string;
}

export type OsmType = "node" | "way" | "relation";

const SOURCE_ID_RE = /^(node|way|relation)\/([1-9][0-9]{0,15})$/;

export function parseSourceId(sourceId: string): { type: OsmType; id: string } | null {
  const m = SOURCE_ID_RE.exec(sourceId);
  return m ? { type: m[1] as OsmType, id: m[2]! } : null;
}

/** Nominatim uses "N"/"W"/"R" in some places and "node"/"way"/"relation" in others. */
export function osmTypeOf(t: string): OsmType | null {
  const s = t.toLowerCase();
  if (s === "n" || s === "node") return "node";
  if (s === "w" || s === "way") return "way";
  if (s === "r" || s === "relation") return "relation";
  return null;
}

/** "relation/175905" → "R175905" (Nominatim /lookup format). */
export function lookupIdOf(sourceId: string): string | null {
  const ref = parseSourceId(sourceId);
  return ref ? `${ref.type[0]!.toUpperCase()}${ref.id}` : null;
}

/** Area kinds (Nominatim addresstype / place type) that can be tokenized. Streets, buildings, shops … cannot. */
const AREA_TYPES: Record<string, string> = {
  country: "Country",
  state: "State",
  province: "Province",
  region: "Region",
  state_district: "District",
  county: "County",
  district: "District",
  municipality: "Municipality",
  city: "City",
  town: "Town",
  village: "Village",
  hamlet: "Hamlet",
  borough: "Borough",
  city_district: "District",
  suburb: "Neighbourhood",
  quarter: "Neighbourhood",
  neighbourhood: "Neighbourhood",
  island: "Island",
  islet: "Island",
  archipelago: "Archipelago",
  territory: "Territory",
  subdivision: "Subdivision",
};

export function placeTypeOf(r: Pick<NominatimResult, "addresstype" | "type" | "category" | "class">): string | null {
  const cls = r.category ?? r.class ?? "";
  const keys = [r.addresstype, r.type].filter((k): k is string => Boolean(k));
  for (const k of keys) if (AREA_TYPES[k]) return AREA_TYPES[k]!;
  if (cls === "boundary" && r.type === "administrative") return "Area";
  return null;
}

export function isArea(r: NominatimResult): boolean {
  const cls = r.category ?? r.class ?? "";
  if (cls !== "boundary" && cls !== "place") return false;
  if (cls === "boundary" && r.type !== "administrative") return false;
  return placeTypeOf(r) !== null;
}

const clean = (s: string | undefined | null, max: number) => {
  const v = (s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

/** English name when OSM has one, otherwise the default name. */
export function englishName(r: NominatimResult): string | null {
  const nd = r.namedetails ?? {};
  return clean(nd["name:en"] || nd["int_name"] || r.name || nd["name"] || r.display_name.split(",")[0], 80);
}

/** Address keys from the largest area to the smallest. */
const ADDRESS_ORDER = [
  "country", "state", "province", "region", "state_district", "county", "municipality", "city", "town", "village",
  "borough", "city_district", "district", "suburb", "quarter", "neighbourhood", "hamlet",
] as const;

/** "New York, United States": the areas this place belongs to (excluding itself), smallest first, max 3. */
export function regionOf(name: string, address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  const parts: string[] = [];
  for (const k of [...ADDRESS_ORDER].reverse()) {
    const v = clean(address[k], 60);
    if (!v || v === name || parts.includes(v)) continue;
    parts.push(v);
  }
  // keep the nearest two areas plus the country
  const country = clean(address.country, 60);
  const near = parts.filter((p) => p !== country).slice(0, 2);
  const out = country && country !== name ? [...near, country] : near;
  return out.length ? out.join(", ") : null;
}

export function bboxOf(r: NominatimResult): BBox | null {
  const bb = r.boundingbox?.map(Number);
  if (!bb || bb.length !== 4 || !bb.every(Number.isFinite)) return null;
  const [s, n, w, e] = bb as [number, number, number, number];
  return [w, s, e, n];
}

export function resultToPlace(r: NominatimResult): PlaceCandidate | null {
  if (r.error) return null;
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  const osmType = r.osm_type ? osmTypeOf(r.osm_type) : null;
  if (!osmType || !r.osm_id || !Number.isFinite(lat) || !Number.isFinite(lng) || !isArea(r)) return null;
  const name = englishName(r);
  if (!name) return null;
  const placeType = placeTypeOf(r);
  return {
    sourceId: `${osmType}/${r.osm_id}`,
    name,
    placeType,
    region: placeType === "Country" ? null : regionOf(name, r.address),
    country: clean(r.address?.country, 80) ?? (placeType === "Country" ? name : null),
    countryCode: clean(r.address?.country_code, 2)?.toUpperCase() ?? null,
    lat,
    lng,
    bbox: bboxOf(r),
  };
}

export function nominatimToResult(r: NominatimResult): SearchResult | null {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const place = resultToPlace(r);
  const label = place?.name ?? englishName(r) ?? "Place";
  const sub = place
    ? [place.placeType, place.region].filter(Boolean).join(" · ")
    : clean(r.display_name.split(",").slice(1, 4).join(","), 120) ?? "";
  return { label, sublabel: sub, lat, lng, bbox: bboxOf(r), place };
}

// ------------------------------------------------------------------ levels

/** Nominatim reverse "zoom" for each area level. */
export const LEVEL_ZOOM: Record<AreaLevel, number> = {
  country: 3,
  state: 5,
  county: 8,
  city: 10,
  town: 12,
  suburb: 13,
  neighbourhood: 14,
};

/** The area level picked by a click at a given map zoom (zoomed out = bigger areas). */
export function levelForMapZoom(z: number): AreaLevel {
  if (z < 4.5) return "country";
  if (z < 7.5) return "state";
  if (z < 10.5) return "city";
  if (z < 13) return "town";
  return "suburb";
}

export interface LevelChoice {
  level: AreaLevel;
  label: string; // e.g. "Brooklyn"
}

/** The areas a point belongs to, from the smallest to the country (for the level switcher). */
export function levelChoices(address: Record<string, string> | undefined): LevelChoice[] {
  if (!address) return [];
  const pick = (keys: string[]) => keys.map((k) => clean(address[k], 60)).find(Boolean) ?? null;
  const rows: [AreaLevel, string | null][] = [
    ["suburb", pick(["suburb", "quarter", "neighbourhood", "city_district"])],
    ["town", pick(["town", "village", "borough", "municipality"])],
    ["city", pick(["city", "town", "municipality"])],
    ["county", pick(["county", "state_district"])],
    ["state", pick(["state", "province", "region"])],
    ["country", pick(["country"])],
  ];
  const out: LevelChoice[] = [];
  for (const [level, label] of rows) {
    if (label && !out.some((o) => o.label === label)) out.push({ level, label });
  }
  return out;
}
