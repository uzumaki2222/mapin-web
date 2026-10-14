"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { MAP_STYLE_URL, applyParchment } from "@/components/map/style";

export type CountryStatus = "none" | "currency" | "live" | "graduated";

interface Props {
  status: Record<string, CountryStatus>; // place id -> status
  selected: string | null;
  onSelect(id: string | null): void;
  onHover?(id: string | null): void;
}

type GeoFeature = { type: "Feature"; id: string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
type Geo = { type: "FeatureCollection"; features: GeoFeature[] };

const COLORS = {
  none: "rgba(43,29,16,0.04)",
  currency: "rgba(255,196,0,0.28)",
  live: "#ffc400",
  graduated: "#2f6b3f",
  line: "#2b1d10",
};

/** World map of countries. Fill colour shows whether the country / its currency has a token. */
export function CountryMap({ status, selected, onSelect, onHover }: Props) {
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
        const geo = (await (await fetch("/world.geo.json")).json()) as Geo;
        if (cancelled || !box.current) return;
        geo.features.forEach((f) => { f.properties = { ...f.properties, iso: f.id }; });
        geoRef.current = geo;
        map = new maplibregl.Map({
          container: box.current,
          style: MAP_STYLE_URL,
          center: [15, 20],
          zoom: 1.3,
          minZoom: 0.8,
          maxZoom: 8,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          renderWorldCopies: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.touchZoomRotate.disableRotation();
        map.on("load", () => {
          if (!map) return;
          applyParchment(map);
          map.addSource("countries", { type: "geojson", data: geo as never, promoteId: "iso" });
          map.addLayer({
            id: "country-fill",
            type: "fill",
            source: "countries",
            paint: {
              "fill-color": [
                "match", ["coalesce", ["feature-state", "status"], "none"],
                "graduated", COLORS.graduated,
                "live", COLORS.live,
                "currency", COLORS.currency,
                COLORS.none,
              ],
              "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.95, 0.8],
            },
          });
          map.addLayer({
            id: "country-line",
            type: "line",
            source: "countries",
            paint: {
              "line-color": COLORS.line,
              "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0.6],
              "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.45],
            },
          });
          let hovered: string | null = null;
          map.on("mousemove", "country-fill", (e) => {
            const id = e.features?.[0]?.properties?.iso as string | undefined;
            if (!id || id === hovered) return;
            if (hovered) map!.setFeatureState({ source: "countries", id: hovered }, { hover: false });
            hovered = id;
            map!.setFeatureState({ source: "countries", id }, { hover: true });
            map!.getCanvas().style.cursor = "pointer";
            cb.current.onHover?.(id);
          });
          map.on("mouseleave", "country-fill", () => {
            if (hovered) map!.setFeatureState({ source: "countries", id: hovered }, { hover: false });
            hovered = null;
            map!.getCanvas().style.cursor = "";
            cb.current.onHover?.(null);
          });
          map.on("click", (e) => {
            const f = map!.queryRenderedFeatures(e.point, { layers: ["country-fill"] })[0];
            cb.current.onSelect((f?.properties?.iso as string | undefined) ?? null);
          });
          setReady(true);
        });
        map.on("error", (e) => {
          const msg = (e as { error?: { message?: string } }).error?.message;
          if (msg && /style|Failed to fetch/i.test(msg)) setFailed("Peta dasar gagal dimuat. Muat ulang halaman.");
        });
      } catch {
        setFailed("Peta gagal dimuat. Muat ulang halaman.");
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

  // selection outline + fly
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const geo = geoRef.current;
    if (!ready || !map || !geo) return;
    if (prevSel.current) map.setFeatureState({ source: "countries", id: prevSel.current }, { selected: false });
    prevSel.current = selected;
    if (!selected) return;
    map.setFeatureState({ source: "countries", id: selected }, { selected: true });
    const f = geo.features.find((x) => x.id === selected);
    if (!f) return;
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") {
        const [x, y] = c as [number, number];
        if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
      } else if (Array.isArray(c)) c.forEach(walk);
    };
    walk(f.geometry.coordinates);
    const desktop = window.innerWidth > 760;
    map.fitBounds([[w, s], [e, n]], {
      padding: desktop ? { top: 60, bottom: 60, left: 60, right: 440 } : { top: 40, bottom: Math.round(window.innerHeight * 0.55), left: 30, right: 30 },
      maxZoom: 5, duration: 900,
    });
  }, [ready, selected]);

  // keep the source fresh if geometry is replaced later (not expected, defensive)
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map && geoRef.current) (map.getSource("countries") as GeoJSONSource | undefined)?.setData(geoRef.current as never);
  }, [ready]);

  return (
    <div className="cmap">
      <div ref={box} className="cmap-canvas" aria-label="Peta dunia, klik negara" />
      {failed ? <div className="cmap-failed">{failed}</div> : null}
    </div>
  );
}
