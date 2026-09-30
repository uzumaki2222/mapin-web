"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapMouseEvent, Marker } from "maplibre-gl";
import type { MapPin } from "@/lib/market/types";
import { MAP_COLORS, MAP_FONT, MAP_STYLE_URL, applyParchment } from "@/components/map/style";
import { outlineFeature } from "@/components/map/outline";

export interface WorldMapHandle {
  flyTo(lat: number, lng: number, zoom?: number): void;
  fitBounds(bbox: [number, number, number, number]): void;
  center(): { lat: number; lng: number; zoom: number } | null;
}

export interface WorldMapProps {
  pins: MapPin[];
  /** clicked point (shown as a marker while its area is looked up) */
  selected: { lat: number; lng: number } | null;
  /** border of the selected place (GeoJSON geometry) */
  outline: unknown | null;
  onPinClick(slug: string): void;
  onMapClick(p: { lat: number; lng: number; zoom: number }): void;
  onZoom?(zoom: number): void;
}

const PIN_LAYERS = ["pins-cluster", "pins-point"];

function pinsGeoJson(pins: MapPin[]) {
  return {
    type: "FeatureCollection" as const,
    features: pins.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { slug: p.slug, label: `$${p.symbol}`, name: p.name },
    })),
  };
}

/** Worldwide map (MapLibre + OpenFreeMap): click anywhere to pick an area; tokenized places are pins. */
export const WorldMap = forwardRef<WorldMapHandle, WorldMapProps>(function WorldMap(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 17) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom, speed: 1.6, essential: true });
    },
    fitBounds([w, s, e, n]) {
      mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 14, duration: 1200 });
    },
    center() {
      const m = mapRef.current;
      if (!m) return null;
      const c = m.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: m.getZoom() };
    },
  }), []);

  // create the map once
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const lib = await import("maplibre-gl");
        const maplibregl = (lib as unknown as { default?: typeof lib }).default ?? lib;
        if (cancelled || !box.current) return;
        libRef.current = maplibregl;
        map = new maplibregl.Map({
          container: box.current,
          style: MAP_STYLE_URL,
          center: [20, 15],
          zoom: 1.4,
          minZoom: 1,
          maxZoom: 19.5,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.addControl(
          new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, fitBoundsOptions: { maxZoom: 16 } }),
          "bottom-right",
        );
        map.touchZoomRotate.disableRotation();

        map.on("load", () => {
          if (!map) return;
          applyParchment(map);
          map.addSource("mapin-outline", { type: "geojson", data: outlineFeature(null) });
          map.addLayer({ id: "outline-fill", type: "fill", source: "mapin-outline", paint: { "fill-color": MAP_COLORS.accent, "fill-opacity": 0.12 } });
          map.addLayer({ id: "outline-line", type: "line", source: "mapin-outline", paint: { "line-color": MAP_COLORS.accent, "line-width": 2.5 } });
          map.addSource("mapin-pins", {
            type: "geojson",
            data: pinsGeoJson(propsRef.current.pins),
            cluster: true,
            clusterRadius: 42,
            clusterMaxZoom: 13,
          });
          map.addLayer({
            id: "pins-cluster",
            type: "circle",
            source: "mapin-pins",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": MAP_COLORS.accent,
              "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24, 200, 30],
              "circle-stroke-color": MAP_COLORS.ink,
              "circle-stroke-width": 2.5,
            },
          });
          map.addLayer({
            id: "pins-cluster-count",
            type: "symbol",
            source: "mapin-pins",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": MAP_FONT, "text-size": 13, "text-allow-overlap": true },
            paint: { "text-color": MAP_COLORS.paper },
          });
          map.addLayer({
            id: "pins-point",
            type: "circle",
            source: "mapin-pins",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": MAP_COLORS.accent,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 6, 12, 9, 17, 12],
              "circle-stroke-color": MAP_COLORS.ink,
              "circle-stroke-width": 2.5,
            },
          });
          map.addLayer({
            id: "pins-label",
            type: "symbol",
            source: "mapin-pins",
            filter: ["!", ["has", "point_count"]],
            minzoom: 9,
            layout: {
              "text-field": ["get", "label"],
              "text-font": MAP_FONT,
              "text-size": 12,
              "text-offset": [0, 1.35],
              "text-anchor": "top",
              "text-allow-overlap": false,
            },
            paint: { "text-color": MAP_COLORS.ink, "text-halo-color": MAP_COLORS.paper, "text-halo-width": 2 },
          });
          setReady(true);
        });

        map.on("mousemove", (e: MapMouseEvent) => {
          if (!map) return;
          const hit = map.queryRenderedFeatures(e.point, { layers: PIN_LAYERS.filter((id) => map!.getLayer(id)) });
          map.getCanvas().style.cursor = hit.length ? "pointer" : "crosshair";
        });
        map.on("zoomend", () => map && propsRef.current.onZoom?.(map.getZoom()));

        map.on("click", (e: MapMouseEvent) => {
          if (!map) return;
          const p = propsRef.current;
          const pad = 6;
          const area: [[number, number], [number, number]] = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
          const pinHits = map.queryRenderedFeatures(area, { layers: PIN_LAYERS.filter((id) => map!.getLayer(id)) });
          const pin = pinHits[0];
          if (pin) {
            if (pin.properties?.cluster_id !== undefined) {
              const src = map.getSource("mapin-pins") as GeoJSONSource;
              const geom = pin.geometry as unknown as { coordinates: [number, number] };
              void src.getClusterExpansionZoom(Number(pin.properties.cluster_id)).then((z) => {
                map!.easeTo({ center: geom.coordinates, zoom: z + 0.5 });
              });
              return;
            }
            p.onPinClick(String(pin.properties?.slug));
            return;
          }
          p.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng, zoom: map.getZoom() });
        });
        map.on("error", (ev: { error?: Error }) => {
          if (ev?.error && /style|Failed to fetch/i.test(String(ev.error.message)) && !map?.isStyleLoaded()) {
            setFailed("The map could not be loaded. Check your connection and reload.");
          }
        });
      } catch (err) {
        setFailed(`The map could not start: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      markerRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // keep pins in sync
  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource("mapin-pins") as GeoJSONSource | undefined;
    src?.setData(pinsGeoJson(props.pins));
  }, [props.pins, ready]);

  // selected place border
  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource("mapin-outline") as GeoJSONSource | undefined;
    src?.setData(outlineFeature(props.outline));
  }, [props.outline, ready]);

  // selection marker
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (props.selected) {
      const el = document.createElement("div");
      el.className = "map-select-marker";
      markerRef.current = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([props.selected.lng, props.selected.lat]).addTo(map);
    }
  }, [props.selected, ready]);

  return (
    <div className="world-map">
      <div ref={box} className="world-map-canvas" aria-label="World map" role="application" />
      {failed ? <div className="world-map-error">{failed}</div> : null}
    </div>
  );
});
