import type { Map as MlMap } from "maplibre-gl";

/**
 * OpenFreeMap: free, no API key, worldwide OpenStreetMap vector tiles (street level everywhere).
 * Override with NEXT_PUBLIC_MAP_STYLE_URL (any MapLibre style, e.g. MapTiler / Stadia) if needed.
 */
export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

/** Font stack that the OpenFreeMap glyph server provides. */
export const MAP_FONT = ["Noto Sans Bold"];

export const MAP_COLORS = {
  accent: "#b5541c",
  claimed: "#2f6b3f",
  ink: "#2b1d10",
  paper: "#fbf3e0",
};

function trySet(map: MlMap, layer: string, prop: string, value: unknown) {
  try {
    map.setPaintProperty(layer, prop, value);
  } catch {
    /* layer/property not in this style — fine */
  }
}

/** Warm "old map" tint on top of the standard style, keeping streets and labels readable. */
export function applyParchment(map: MlMap): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const l of layers) {
    const id = l.id;
    if (l.type === "background") trySet(map, id, "background-color", "#efe2c4");
    else if (l.type === "fill" && /water|ocean|lake|river/i.test(id)) trySet(map, id, "fill-color", "#b9cbc4");
    else if (l.type === "line" && /waterway|river/i.test(id)) trySet(map, id, "line-color", "#a9bfb7");
    else if (l.type === "fill" && /park|wood|forest|grass|landcover|landuse_park/i.test(id)) trySet(map, id, "fill-color", "#d5d4a3");
    else if (l.type === "fill" && /landuse|residential/i.test(id)) trySet(map, id, "fill-color", "#e8d8b5");
    else if (l.type === "fill" && /building/i.test(id)) trySet(map, id, "fill-color", "#dcc59b");
    else if (l.type === "fill-extrusion" && /building/i.test(id)) trySet(map, id, "fill-extrusion-color", "#dcc59b");
  }
}

/** Symbol layers that show points of interest (shops, cafés, restaurants, …) in an OpenMapTiles style. */
export function poiLayerIds(map: MlMap): string[] {
  const layers = map.getStyle()?.layers ?? [];
  return layers
    .filter((l) => l.type === "symbol" && (l as { "source-layer"?: string })["source-layer"] === "poi" && !/transit|station|bus|rail/i.test(l.id))
    .map((l) => l.id);
}

/** Best display name of a vector-tile feature. */
export function featureName(props: Record<string, unknown> | null | undefined): string | null {
  if (!props) return null;
  for (const k of ["name", "name:latin", "name_en", "name_int", "name:en"]) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
