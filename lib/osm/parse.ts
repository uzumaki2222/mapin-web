// Pure OpenStreetMap parsing: Overpass elements and Nominatim results → mapin place shapes.
// No I/O here so it can be unit tested.

import type { PlaceCandidate, SearchResult } from "../market/types.ts";

/** OSM keys that mark a place as a business / point of interest someone could tokenize. */
export const BUSINESS_KEYS = ["shop", "amenity", "tourism", "craft", "office", "leisure", "healthcare", "club"] as const;

/** amenity values that are infrastructure, not businesses. */
const NON_BUSINESS_AMENITY = new Set([
  "bench", "bicycle_parking", "parking", "parking_space", "parking_entrance", "waste_basket", "waste_disposal",
  "recycling", "toilets", "drinking_water", "fountain", "shelter", "telephone", "post_box", "vending_machine",
  "grit_bin", "clock", "loading_dock", "motorcycle_parking", "bicycle_rental", "charging_station", "atm",
  "hunting_stand", "water_point", "watering_place", "letter_box", "bbq", "lounger", "dog_toilet",
]);

export type OsmTags = Record<string, string>;

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
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

/** "cafe", "Clothes shop", … — a short human label for the business type, or null. */
export function categoryOf(tags: OsmTags): string | null {
  for (const k of BUSINESS_KEYS) {
    const v = tags[k];
    if (!v || v === "yes" || v === "no") continue;
    if (k === "amenity" && NON_BUSINESS_AMENITY.has(v)) return null;
    const label = v.replace(/_/g, " ").split(";")[0]!.trim();
    const pretty = label.charAt(0).toUpperCase() + label.slice(1);
    return k === "shop" && !/shop|store|market/i.test(label) ? `${pretty} shop` : pretty;
  }
  return null;
}

export function isBusinessTags(tags: OsmTags | undefined): boolean {
  if (!tags?.name) return false;
  return categoryOf(tags) !== null;
}

export function websiteOf(tags: OsmTags): string | null {
  const w = (tags.website || tags["contact:website"] || tags.url || "").trim();
  if (!w) return null;
  const withScheme = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

export function addressOf(tags: OsmTags): string | null {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const parts = [street || tags["addr:place"], tags["addr:suburb"] || tags["addr:district"]].filter(Boolean);
  return parts.length ? parts.join(", ").slice(0, 200) : null;
}

const clean = (s: string | undefined | null, max: number) => {
  const v = (s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

/** Overpass element → candidate (null when it is not a named business). */
export function elementToCandidate(el: OverpassElement): PlaceCandidate | null {
  const tags = el.tags ?? {};
  if (!isBusinessTags(tags)) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return {
    source: "osm",
    sourceId: `${el.type}/${el.id}`,
    name: clean(tags.name, 80)!,
    category: categoryOf(tags),
    address: addressOf(tags),
    city: clean(tags["addr:city"], 80),
    country: null,
    countryCode: clean(tags["addr:country"], 2)?.toUpperCase() ?? null,
    website: websiteOf(tags),
    lat,
    lng,
  };
}

/** Case/accent/punctuation-insensitive comparison key for place names. */
export function nameKey(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The element the user most likely clicked: a business whose name (in any language variant) matches
 * the label on the map, nearest first. Falls back to the nearest business when no name is given.
 */
export function pickClicked(elements: OverpassElement[], lat: number, lng: number, label: string | null): PlaceCandidate | null {
  const want = label ? nameKey(label) : "";
  let best: { c: PlaceCandidate; score: number } | null = null;
  for (const el of elements) {
    const c = elementToCandidate(el);
    if (!c) continue;
    const tags = el.tags ?? {};
    const names = Object.entries(tags)
      .filter(([k]) => k === "name" || k.startsWith("name:") || k === "brand" || k === "official_name")
      .map(([, v]) => nameKey(v));
    const nameMatch = want ? names.includes(want) : false;
    if (want && !nameMatch) continue;
    const d = distanceM(lat, lng, c.lat, c.lng);
    if (!best || d < best.score) best = { c, score: d };
  }
  return best?.c ?? null;
}

// ------------------------------------------------------------------ Nominatim

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
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
}

export function cityOf(address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  return clean(address.city || address.town || address.village || address.municipality || address.county || address.state, 80);
}

export function nominatimToResult(r: NominatimResult): SearchResult | null {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cls = r.category ?? r.class ?? "";
  const type = r.type ?? "";
  const tags: OsmTags = { ...(r.extratags ?? {}), ...(r.name ? { name: r.name } : {}) };
  if ((BUSINESS_KEYS as readonly string[]).includes(cls) && type) tags[cls] = type;
  const osmType = r.osm_type ? osmTypeOf(r.osm_type) : null;
  const addr = r.address;
  const city = cityOf(addr);
  const country = clean(addr?.country, 80);
  const place: PlaceCandidate | null =
    osmType && r.osm_id && isBusinessTags(tags)
      ? {
          source: "osm",
          sourceId: `${osmType}/${r.osm_id}`,
          name: clean(tags.name, 80)!,
          category: categoryOf(tags),
          address: clean([addr?.road, addr?.house_number].filter(Boolean).join(" ") || addr?.suburb, 200),
          city,
          country,
          countryCode: clean(addr?.country_code, 2)?.toUpperCase() ?? null,
          website: websiteOf(tags),
          lat,
          lng,
        }
      : null;
  const bb = r.boundingbox?.map(Number);
  const bbox: SearchResult["bbox"] =
    !place && bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[2]!, bb[0]!, bb[3]!, bb[1]!] : null;
  const label = place?.name ?? clean(r.name, 80) ?? clean(r.display_name.split(",")[0], 80) ?? "Place";
  const sub = clean(r.display_name.split(",").slice(1, 4).join(","), 120) ?? "";
  return { label, sublabel: place?.category ? `${place.category} · ${sub}` : sub, lat, lng, bbox, place };
}
