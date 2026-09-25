"use client";

import dynamic from "next/dynamic";
import type { MapViewProps } from "./MapView";
import { useSystem } from "./SystemProvider";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-sm text-muted" aria-hidden>
      Loading map…
    </div>
  ),
});

export type { MapLine, MapMarker, MapShape } from "./MapView";

/** Map that picks Azure Maps tiles when configured, OpenStreetMap otherwise. */
export function OpsMap(props: Omit<MapViewProps, "provider">) {
  const sys = useSystem();
  return <MapView {...props} provider={sys.maps} />;
}
