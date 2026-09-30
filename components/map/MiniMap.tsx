"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { BBox } from "@/lib/market/types";
import { MAP_COLORS, MAP_STYLE_URL, applyParchment } from "@/components/map/style";
import { outlineFeature, usableBBox } from "@/components/map/outline";

/** Small static map of one place, with its border when available. */
export function MiniMap({ lat, lng, bbox, placeId, label }: { lat: number; lng: number; bbox: BBox | null; placeId: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    (async () => {
      const lib = await import("maplibre-gl");
      const maplibregl = (lib as unknown as { default?: typeof lib }).default ?? lib;
      if (cancelled || !box.current) return;
      const bb = usableBBox(bbox);
      map = new maplibregl.Map({
        container: box.current,
        style: MAP_STYLE_URL,
        center: [lng, lat],
        zoom: 9,
        interactive: false,
        attributionControl: { compact: true },
      });
      if (bb) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 20, duration: 0 });
      map.on("load", async () => {
        if (!map) return;
        applyParchment(map);
        map.addSource("outline", { type: "geojson", data: outlineFeature(null) });
        map.addLayer({ id: "outline-fill", type: "fill", source: "outline", paint: { "fill-color": MAP_COLORS.accent, "fill-opacity": 0.14 } });
        map.addLayer({ id: "outline-line", type: "line", source: "outline", paint: { "line-color": MAP_COLORS.accent, "line-width": 2.5 } });
        try {
          const r = await fetch(`/api/places/${placeId}/outline`).then((x) => x.json());
          if (!cancelled) (map.getSource("outline") as GeoJSONSource | undefined)?.setData(outlineFeature(r.geometry));
        } catch {
          /* outline is decorative */
        }
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, bbox, placeId]);
  return <div ref={box} className="mini-map" role="img" aria-label={`Map of ${label}`} />;
}
