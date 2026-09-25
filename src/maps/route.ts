import { config } from "@/config";
import { recordFailure, recordSuccess } from "@/providers/serviceHealth";
import type { Position, RoutePlan } from "@/domain/ops";
import { bbox, pathAffected } from "@/engine/geometry";
import { round1 } from "@/engine/geo";
import { ROUTE_STATEMENT_AVOIDING, ROUTE_STATEMENT_CLEAR, routeConflicts, type Restriction, type RouteEndpoint } from "@/engine/routing";

/**
 * Azure Maps Route Directions (v1.0) with live traffic and avoid-areas.
 *
 * Known restrictions are converted to bounding rectangles (the API accepts at
 * most 10 rectangular avoid areas). The result is re-checked against the exact
 * restriction geometry by the caller — Azure Maps is trusted for travel time,
 * never for safety.
 *
 * Not reachable from the development sandbox; verified against the published
 * API contract only. Any error returns null and the caller falls back.
 */

const MAX_AVOID_AREAS = 10;

function avoidRectangles(restrictions: Restriction[]): Position[][][] {
  return restrictions.slice(0, MAX_AVOID_AREAS).map((r) => {
    const [w, s, e, n] = bbox(r.geometry, Math.max(r.radiusM, 50));
    return [
      [
        [w, n],
        [e, n],
        [e, s],
        [w, s],
        [w, n],
      ],
    ];
  });
}

interface AzureRouteResponse {
  routes?: {
    summary?: { lengthInMeters?: number; travelTimeInSeconds?: number; trafficDelayInSeconds?: number };
    legs?: { points?: { latitude: number; longitude: number }[] }[];
    guidance?: { instructions?: { street?: string; roadNumbers?: string[] }[] };
  }[];
}

export async function azureMapsRoute(args: { origin: RouteEndpoint; destination: RouteEndpoint; restrictions: Restriction[]; version: number; now: Date }): Promise<RoutePlan | null> {
  const maps = config().maps;
  if (!maps) return null;
  const { origin, destination, restrictions } = args;
  const query = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
  const url = `https://atlas.microsoft.com/route/directions/json?api-version=1.0&traffic=true&travelMode=car&routeType=fastest&instructionsType=text&query=${encodeURIComponent(query)}`;
  try {
    const avoid = avoidRectangles(restrictions);
    const res = await fetch(url, {
      method: "POST",
      headers: { "subscription-key": maps.key, "content-type": "application/json" },
      body: JSON.stringify(avoid.length ? { avoidAreas: { type: "MultiPolygon", coordinates: avoid } } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      recordFailure("azure-maps", new Error(`Route Directions HTTP ${res.status}`));
      return null;
    }
    const data = (await res.json()) as AzureRouteResponse;
    recordSuccess("azure-maps");
    const r = data.routes?.[0];
    const pts = r?.legs?.flatMap((l) => l.points ?? []) ?? [];
    if (!r?.summary?.travelTimeInSeconds || pts.length < 2) return null;
    const roads = Array.from(new Set((r.guidance?.instructions ?? []).map((i) => i.roadNumbers?.[0] ?? i.street).filter((x): x is string => !!x))).slice(0, 6);
    const path: Position[] = pts.filter((p) => Number.isFinite(p?.longitude) && Number.isFinite(p?.latitude)).map((p) => [p.longitude, p.latitude]);
    // Trusted for travel time, never for safety: the FULL path is checked against exact restriction geometry.
    if (path.length < 2 || routeConflicts(path, restrictions).length) return null;
    // Keep payloads small: every ~5th point plus the ends (after the safety check).
    const thin = path.filter((_, i) => i === 0 || i === path.length - 1 || i % 5 === 0);
    // Report only restrictions near this route, not every restriction in the region.
    const nearby = restrictions.filter((x) => pathAffected(path, x.geometry, x.radiusM + 1000));
    return {
      version: args.version,
      provider: "azure-maps",
      origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
      destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
      path: thin,
      roads,
      distanceKm: round1((r.summary.lengthInMeters ?? 0) / 1000),
      etaMinutes: Math.max(1, Math.round(r.summary.travelTimeInSeconds / 60)),
      computedAt: args.now.toISOString(),
      avoided: nearby.map((x) => ({ clusterId: x.clusterId, title: x.title, reason: x.kind === "BLOCKS_ROAD" ? "road blocked" : x.kind === "NO_CIVILIAN_ENTRY" ? "no civilian entry" : "area avoided" })),
      statement: nearby.length ? ROUTE_STATEMENT_AVOIDING : ROUTE_STATEMENT_CLEAR,
    };
  } catch (err) {
    recordFailure("azure-maps", err);
    return null;
  }
}
