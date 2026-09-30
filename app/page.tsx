import { Suspense } from "react";
import { MapHome } from "@/components/map/MapHome";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="map-home" />}>
      <MapHome />
    </Suspense>
  );
}
