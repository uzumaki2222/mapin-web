import type { BBox } from "@/lib/market/types";

/** Feature collection for a place outline (Polygon / MultiPolygon only; points and lines are skipped). */
export function outlineFeature(geometry: unknown): { type: "FeatureCollection"; features: unknown[] } {
  const g = geometry as { type?: string } | null;
  const ok = g && (g.type === "Polygon" || g.type === "MultiPolygon");
  return { type: "FeatureCollection", features: ok ? [{ type: "Feature", geometry: g, properties: {} }] : [] };
}

/** Bounding box usable for fitBounds (ignores degenerate point boxes). */
export function usableBBox(b: BBox | null): BBox | null {
  if (!b) return null;
  const [w, s, e, n] = b;
  return Math.abs(e - w) > 0.0005 || Math.abs(n - s) > 0.0005 ? b : null;
}
