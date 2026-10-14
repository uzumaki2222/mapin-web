"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { MAP_STYLE_URL, applyParchment } from "@/components/map/style";

/** Small static map of one business location. */
export function MiniMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    (async () => {
      const lib = await import("maplibre-gl");
      const maplibregl = (lib as unknown as { default?: typeof lib }).default ?? lib;
      if (cancelled || !box.current) return;
      map = new maplibregl.Map({
        container: box.current,
        style: MAP_STYLE_URL,
        center: [lng, lat],
        zoom: 16,
        interactive: false,
        attributionControl: { compact: true },
      });
      map.on("load", () => map && applyParchment(map));
      const el = document.createElement("div");
      el.className = "map-select-marker";
      el.title = label;
      new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, label]);
  return <div ref={box} className="mini-map" role="img" aria-label={`Map of ${label}`} />;
}
