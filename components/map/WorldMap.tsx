"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapMouseEvent, Marker } from "maplibre-gl";
import type { MapPin } from "@/lib/market/types";
import { MAP_COLORS, MAP_FONT, MAP_STYLE_URL, applyParchment, featureName, poiLayerIds } from "@/components/map/style";

export interface WorldMapHandle {
  flyTo(lat: number, lng: number, zoom?: number): void;
  fitBounds(bbox: [number, number, number, number]): void;
  center(): { lat: number; lng: number; zoom: number } | null;
}

export interface WorldMapProps {
  pins: MapPin[];
  /** highlighted location (selected business or the spot being added) */
  selected: { lat: number; lng: number } | null;
  addMode: boolean;
  onPinClick(slug: string): void;
  onPoiClick(p: { lat: number; lng: number; label: string | null }): void;
  onPointPick(p: { lat: number; lng: number }): void;
  onEmptyClick(): void;
  onZoom?(zoom: number): void;
}

const PIN_LAYERS = ["pins-cluster", "pins-point"];

function pinsGeoJson(pins: MapPin[]) {
  return {
    type: "FeatureCollection" as const,
    features: pins.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { slug: p.slug, label: `$${p.symbol}`, name: p.name, claimed: p.claimed ? 1 : 0 },
    })),
  };
}

/** Worldwide street-level map (MapLibre + OpenFreeMap) with tokenized businesses as pins. */
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
      mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 15, duration: 1200 });
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
              "circle-color": ["case", ["==", ["get", "claimed"], 1], MAP_COLORS.claimed, MAP_COLORS.accent],
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

        const clickable = () => [...PIN_LAYERS, ...poiLayerIds(map!)].filter((id) => map!.getLayer(id));
        map.on("mousemove", (e: MapMouseEvent) => {
          if (!map) return;
          if (propsRef.current.addMode) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          const hit = map.queryRenderedFeatures(e.point, { layers: clickable() });
          map.getCanvas().style.cursor = hit.length ? "pointer" : "";
        });
        map.on("zoomend", () => map && propsRef.current.onZoom?.(map.getZoom()));

        map.on("click", (e: MapMouseEvent) => {
          if (!map) return;
          const p = propsRef.current;
          const pad = 6;
          const area: [[number, number], [number, number]] = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
          const pinHits = map.queryRenderedFeatures(area, { layers: PIN_LAYERS.filter((id) => map!.getLayer(id)) });
          const pin = pinHits[0];
          if (pin && !p.addMode) {
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
          if (p.addMode) {
            p.onPointPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
            return;
          }
          const poiIds = poiLayerIds(map).filter((id) => map!.getLayer(id));
          const poi = poiIds.length ? map.queryRenderedFeatures(area, { layers: poiIds })[0] : undefined;
          if (poi) {
            const g = poi.geometry as unknown as { type: string; coordinates: [number, number] };
            const [lng, lat] = g.type === "Point" ? g.coordinates : [e.lngLat.lng, e.lngLat.lat];
            p.onPoiClick({ lat, lng, label: featureName(poi.properties as Record<string, unknown>) });
            return;
          }
          p.onEmptyClick();
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

  // selection marker
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (props.selected) {
      const el = document.createElement("div");
      el.className = `map-select-marker${props.addMode ? " is-add" : ""}`;
      markerRef.current = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([props.selected.lng, props.selected.lat]).addTo(map);
    }
  }, [props.selected, props.addMode, ready]);

  return (
    <div className="world-map" data-add-mode={props.addMode || undefined}>
      <div ref={box} className="world-map-canvas" aria-label="World map" role="application" />
      {failed ? <div className="world-map-error">{failed}</div> : null}
    </div>
  );
});
