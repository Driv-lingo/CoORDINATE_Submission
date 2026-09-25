import type { Metadata } from "next";
import PublicHazardMap from "./PublicHazardMap";

export const metadata: Metadata = { title: "Hazard map" };

export default function MapPage() {
  return <PublicHazardMap />;
}
