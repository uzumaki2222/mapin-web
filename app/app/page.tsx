import type { Metadata } from "next";
import { Suspense } from "react";
import { MapHome } from "@/components/map/MapHome";

export const metadata: Metadata = { title: "Map" };

export default function AppPage() {
  return (
    <Suspense fallback={<div className="map-home" />}>
      <MapHome />
    </Suspense>
  );
}
