"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";

export type CountryStatus = "none" | "currency" | "live" | "graduated";

interface Props {
  status: Record<string, CountryStatus>; // place id -> status
  onSelect(id: string): void;
  onHover?(hit: { id: string; x: number; y: number } | null): void;
}

type GeoFeature = { type: "Feature"; id: string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
type Geo = { type: "FeatureCollection"; features: GeoFeature[] };

export const MAP_FILL = {
  none: "#222930",
  hover: "#36414b",
  currency: "#7a5f0c",
  live: "#ffc400",
  graduated: "#3ad08a",
  ocean: "#0d1115",
  line: "#0d1115",
};

/**
 * World map of countries on a blank MapLibre style (no tile server, no glyphs: nothing external to
 * fail). Fill colour shows whether a country / its currency has a token. Click opens the country.
 */
export function CountryMap({ status, onSelect, onHover }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const geoRef = useRef<Geo | null>(null);
  const cb = useRef({ onSelect, onHover });
  cb.current = { onSelect, onHover };
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const lib = await import("maplibre-gl");
        const maplibregl = (lib as unknown as { default?: typeof lib }).default ?? lib;
        const res = await fetch("/world.geo.json");
        if (!res.ok) throw new Error(`world.geo.json ${res.status}`);
        const geo = (await res.json()) as Geo;
        if (cancelled || !box.current) return;
        geo.features.forEach((f) => { f.properties = { ...f.properties, iso: f.id }; });
        geoRef.current = geo;
        const narrow = box.current.clientWidth < 700;
        map = new maplibregl.Map({
          container: box.current,
          style: {
            version: 8,
            // Glyphs only draw the country names; if they fail to load, the map still works without labels.
            glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            sources: {},
            layers: [{ id: "ocean", type: "background", paint: { "background-color": MAP_FILL.ocean } }],
          },
          center: [12, 22],
          zoom: narrow ? 0.35 : 1.25,
          minZoom: 0,
          maxZoom: 7,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          renderWorldCopies: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.touchZoomRotate.disableRotation();
        map.scrollZoom.disable(); // the page scrolls; zoom with buttons, pinch or double-click
        map.on("load", () => {
          if (!map) return;
          map.addSource("countries", { type: "geojson", data: geo as never, promoteId: "iso" });
          map.addLayer({
            id: "country-fill",
            type: "fill",
            source: "countries",
            paint: {
              "fill-color": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                [
                  "match", ["coalesce", ["feature-state", "status"], "none"],
                  "graduated", "#6be3a9",
                  "live", "#ffd84d",
                  "currency", "#9a7a17",
                  MAP_FILL.hover,
                ],
                [
                  "match", ["coalesce", ["feature-state", "status"], "none"],
                  "graduated", MAP_FILL.graduated,
                  "live", MAP_FILL.live,
                  "currency", MAP_FILL.currency,
                  MAP_FILL.none,
                ],
              ],
            },
          });
          map.addLayer({
            id: "country-line",
            type: "line",
            source: "countries",
            paint: { "line-color": MAP_FILL.line, "line-width": 0.7 },
          });
          // country names: big countries first, smaller ones appear as you zoom in
          map.addSource("labels", { type: "geojson", data: "/world-labels.geo.json" });
          const label = (id: string, cls: number, minzoom: number, size: [number, number]) =>
            map!.addLayer({
              id,
              type: "symbol",
              source: "labels",
              minzoom,
              filter: ["==", ["get", "c"], cls],
              layout: {
                "text-field": ["get", "n"],
                "text-font": ["Noto Sans Bold"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 0, size[0], 6, size[1]],
                "text-transform": "uppercase",
                "text-letter-spacing": 0.06,
                "text-max-width": 8,
                "text-padding": 4,
                "symbol-sort-key": ["-", 0, ["get", "a"]],
              },
              paint: { "text-color": "#e9e5da", "text-halo-color": "rgba(13,17,21,0.9)", "text-halo-width": 1.4, "text-opacity": 0.92 },
            });
          label("labels-1", 1, 0.6, [9, 20]);
          label("labels-2", 2, 1.8, [9, 17]);
          label("labels-3", 3, 2.8, [9, 15]);
          label("labels-4", 4, 3.8, [9, 13]);
          let hovered: string | null = null;
          const clear = () => {
            if (hovered) map!.setFeatureState({ source: "countries", id: hovered }, { hover: false });
            hovered = null;
          };
          map.on("mousemove", "country-fill", (e) => {
            const id = e.features?.[0]?.properties?.iso as string | undefined;
            if (!id) return;
            if (id !== hovered) {
              clear();
              hovered = id;
              map!.setFeatureState({ source: "countries", id }, { hover: true });
            }
            map!.getCanvas().style.cursor = "pointer";
            cb.current.onHover?.({ id, x: e.point.x, y: e.point.y });
          });
          map.on("mouseleave", "country-fill", () => {
            clear();
            map!.getCanvas().style.cursor = "";
            cb.current.onHover?.(null);
          });
          map.on("click", "country-fill", (e) => {
            const id = e.features?.[0]?.properties?.iso as string | undefined;
            if (id) cb.current.onSelect(id);
          });
          setReady(true);
        });
      } catch {
        if (!cancelled) setFailed("The map could not load. Refresh the page.");
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // push statuses into feature-state
  useEffect(() => {
    const map = mapRef.current;
    const geo = geoRef.current;
    if (!ready || !map || !geo) return;
    for (const f of geo.features) map.setFeatureState({ source: "countries", id: f.id }, { status: status[f.id] ?? "none" });
  }, [ready, status]);

  return (
    <div className="mp-map">
      <div ref={box} className="mp-map-canvas" aria-label="World map. Click a country to open it." />
      {!ready && !failed ? <div className="mp-map-msg">Loading map…</div> : null}
      {failed ? <div className="mp-map-msg">{failed}</div> : null}
    </div>
  );
}
