import { CONNECTOR_SPEED_KMH, NODE_DELAY_MIN, ROAD_EDGES, ROAD_NODES, WINDING_FACTOR, type RoadEdge, type RoadNode } from "@/data/roadGraph";
import type { Geometry, Position, RoutePlan } from "@/domain/ops";
import type { GeoPoint, Incident, Responder } from "@/domain/types";
import { distanceKm, round1 } from "./geo";
import { pointAffected, segmentAffected } from "./geometry";

/**
 * Deterministic routing over a road graph, honouring known restrictions:
 *
 *   usable network = road network − closures − prohibited areas
 *   route          = fastest path within the usable network
 *
 * Restrictions come only from ACTIONABLE effects (see engine/correlate.ts):
 * an unverified news item or a lone machine-derived camera observation can
 * never close a road here.
 */

export interface Restriction {
  clusterId: string;
  title: string;
  geometry: Geometry;
  radiusM: number;
  kind: "BLOCKS_ROAD" | "AVOID_AREA" | "NO_CIVILIAN_ENTRY";
}

export interface Slowdown {
  clusterId: string;
  title: string;
  geometry: Geometry;
  radiusM: number;
  delayMinutes: number;
}

export interface RouteEndpoint extends GeoPoint {
  label: string;
}

export const ROUTE_STATEMENT_CLEAR = "No known blocking condition was detected on this route from the currently available data.";
export const ROUTE_STATEMENT_AVOIDING = "This route avoids currently known closures and operational restrictions.";

interface Graph {
  nodes: Map<string, RoadNode>;
  adj: Map<string, { to: string; edge: RoadEdge }[]>;
}

function buildGraph(): Graph {
  const nodes = new Map(ROAD_NODES.map((n) => [n.id, n]));
  const adj = new Map<string, { to: string; edge: RoadEdge }[]>();
  for (const e of ROAD_EDGES) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), { to: e.b, edge: e }]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), { to: e.a, edge: e }]);
  }
  return { nodes, adj };
}

const GRAPH = buildGraph();
const pos = (n: { lat: number; lng: number }): Position => [n.lng, n.lat];

/** Maximum distance from the network for the scenario router to accept an endpoint. */
export const GRAPH_COVERAGE_KM = 6;

export function nearestNode(p: GeoPoint): { node: RoadNode; km: number } {
  let best = ROAD_NODES[0];
  let bestKm = Infinity;
  for (const n of ROAD_NODES) {
    const d = distanceKm(p, n);
    if (d < bestKm) {
      bestKm = d;
      best = n;
    }
  }
  return { node: best, km: bestKm };
}

export function graphCovers(p: GeoPoint): boolean {
  return nearestNode(p).km <= GRAPH_COVERAGE_KM;
}

function blockedBy(a: Position, b: Position, restrictions: Restriction[]): Restriction | undefined {
  return restrictions.find((r) => segmentAffected(a, b, r.geometry, r.radiusM));
}

function edgeMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }, speed: number): { km: number; min: number } {
  const km = distanceKm(a, b) * WINDING_FACTOR;
  return { km, min: (km / speed) * 60 };
}

/**
 * Fastest route on the scenario road graph. Returns null when every path is
 * blocked — the caller must then HOLD, never "route anyway".
 */
export function routeOnGraph(args: {
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  restrictions: Restriction[];
  slowdowns?: Slowdown[];
  version: number;
  now: Date;
}): RoutePlan | null {
  const { origin, destination, restrictions } = args;
  const slowdowns = args.slowdowns ?? [];
  const start = nearestNode(origin).node;
  const end = nearestNode(destination).node;

  // Connectors from the endpoints to the network can themselves be blocked.
  if (blockedBy(pos(origin), pos(start), restrictions) || blockedBy(pos(end), pos(destination), restrictions)) return null;

  const dist = new Map<string, number>([[start.id, 0]]);
  const prev = new Map<string, { from: string; edge: RoadEdge }>();
  const done = new Set<string>();
  const avoided = new Map<string, Restriction>();

  while (true) {
    let u: string | undefined;
    let best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) [u, best] = [id, d];
    if (!u || u === end.id) break;
    done.add(u);
    const un = GRAPH.nodes.get(u)!;
    for (const { to, edge } of GRAPH.adj.get(u) ?? []) {
      if (done.has(to)) continue;
      const vn = GRAPH.nodes.get(to)!;
      const block = blockedBy(pos(un), pos(vn), restrictions);
      if (block) {
        avoided.set(block.clusterId, block);
        continue;
      }
      let { min } = edgeMinutes(un, vn, edge.speedKmh);
      for (const s of slowdowns) if (segmentAffected(pos(un), pos(vn), s.geometry, s.radiusM)) min += s.delayMinutes;
      const cand = best + min + NODE_DELAY_MIN;
      if (cand < (dist.get(to) ?? Infinity)) {
        dist.set(to, cand);
        prev.set(to, { from: u, edge });
      }
    }
  }
  if (!dist.has(end.id)) return null;

  // Reconstruct.
  const nodeIds: string[] = [end.id];
  const roads: string[] = [];
  let cur = end.id;
  while (cur !== start.id) {
    const p = prev.get(cur);
    if (!p) return null;
    if (roads[0] !== p.edge.road) roads.unshift(p.edge.road);
    nodeIds.unshift(p.from);
    cur = p.from;
  }

  let km = 0;
  for (let i = 1; i < nodeIds.length; i++) km += distanceKm(GRAPH.nodes.get(nodeIds[i - 1])!, GRAPH.nodes.get(nodeIds[i])!) * WINDING_FACTOR;
  const c1 = edgeMinutes(origin, start, CONNECTOR_SPEED_KMH);
  const c2 = edgeMinutes(end, destination, CONNECTOR_SPEED_KMH);
  const minutes = dist.get(end.id)! + c1.min + c2.min;

  const path: Position[] = [pos(origin), ...nodeIds.map((id) => pos(GRAPH.nodes.get(id)!)), pos(destination)];
  // Only report restrictions that actually shaped this route (they touched an edge we considered).
  const shaped = [...avoided.values()];
  return {
    version: args.version,
    provider: "demo-road-graph",
    origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
    destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
    path,
    roads,
    distanceKm: round1(km + c1.km + c2.km),
    etaMinutes: Math.max(1, Math.round(minutes)),
    computedAt: args.now.toISOString(),
    avoided: shaped.map((r) => ({ clusterId: r.clusterId, title: r.title, reason: r.kind === "BLOCKS_ROAD" ? "road blocked" : r.kind === "NO_CIVILIAN_ENTRY" ? "no civilian entry" : "area avoided" })),
    statement: shaped.length ? ROUTE_STATEMENT_AVOIDING : ROUTE_STATEMENT_CLEAR,
  };
}

/** Fallback when no router covers the endpoints: straight line × winding at a conservative speed. Clearly labelled. */
export function straightLineEstimate(origin: RouteEndpoint, destination: RouteEndpoint, version: number, now: Date): RoutePlan {
  const km = distanceKm(origin, destination) * 1.35;
  return {
    version,
    provider: "straight-line-estimate",
    origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
    destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
    path: [pos(origin), pos(destination)],
    roads: [],
    distanceKm: round1(km),
    etaMinutes: Math.max(1, Math.round((km / 40) * 60)),
    computedAt: now.toISOString(),
    avoided: [],
    statement: "Estimate only — no road routing for this area. The straight line crosses no known restriction, but actual roads were not checked.",
  };
}

/** Which restrictions intersect an existing route's path? */
export function routeConflicts(path: Position[], restrictions: Restriction[]): Restriction[] {
  const hits: Restriction[] = [];
  for (const r of restrictions) {
    for (let i = 1; i < path.length; i++) {
      if (segmentAffected(path[i - 1], path[i], r.geometry, r.radiusM)) {
        hits.push(r);
        break;
      }
    }
  }
  return hits;
}

/** Route endpoints for a mission: the team lead's staging location → the incident site. */
export function missionEndpoints(incident: Pick<Incident, "location" | "locationLabel">, lead: Responder | undefined): { origin: RouteEndpoint; destination: RouteEndpoint } | null {
  if (!lead) return null;
  return {
    origin: { lat: lead.location.lat, lng: lead.location.lng, label: `${lead.name} (${lead.locality})` },
    destination: { lat: incident.location.lat, lng: incident.location.lng, label: incident.locationLabel },
  };
}

/**
 * Deterministic planner used in scenario mode (and as the live fallback):
 * the road graph where it covers both ends, otherwise a clearly labelled
 * straight-line estimate — which is refused (null → hold) if it crosses a
 * known restriction, because it cannot route around anything.
 */
export function planDeterministicRoute(args: {
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  restrictions: Restriction[];
  slowdowns?: Slowdown[];
  version: number;
  now: Date;
  /** Live mode: the scenario road graph is not a real network — estimate only. */
  allowGraph?: boolean;
}): RoutePlan | null {
  // A blockage covering the site itself is the job, not an obstacle.
  const dest: Position = [args.destination.lng, args.destination.lat];
  const restrictions = args.restrictions.filter((r) => !(r.kind === "BLOCKS_ROAD" && pointAffected(dest, r.geometry, r.radiusM)));
  if (args.allowGraph !== false && graphCovers(args.origin) && graphCovers(args.destination)) return routeOnGraph({ ...args, restrictions });
  const est = straightLineEstimate(args.origin, args.destination, args.version, args.now);
  return routeConflicts(est.path, restrictions).length ? null : est;
}
