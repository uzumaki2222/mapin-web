import type { Metadata } from "next";
import { ExploreView } from "@/components/explore/ExploreView";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return <ExploreView />;
}
