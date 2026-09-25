import type { GeoPoint } from "@/domain/types";
import type { Geometry, Position } from "@/domain/ops";
import { distanceKm } from "./geo";

/**
 * Small, dependency-free planar geometry for hazard intersection at city/county
 * scale. Positions are [lng, lat]. Distances use a local equirectangular
 * projection, which is accurate to well under 1% over the tens of kilometres
 * an operation spans.
 */

const R = 6371000;

function project(p: Position, lat0: number): [number, number] {
  const x = (p[0] * Math.PI) / 180 * R * Math.cos((lat0 * Math.PI) / 180);
  const y = (p[1] * Math.PI) / 180 * R;
  return [x, y];
}

export const toPosition = (p: GeoPoint): Position => [p.lng, p.lat];
export const toPoint = (p: Position): GeoPoint => ({ lat: p[1], lng: p[0] });

/** Distance in metres from point p to segment a–b. */
export function pointSegmentDistanceM(p: Position, a: Position, b: Position): number {
  const lat0 = (a[1] + b[1] + p[1]) / 3;
  const [px, py] = project(p, lat0);
  const [ax, ay] = project(a, lat0);
  const [bx, by] = project(b, lat0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: Position, polygon: Position[][]): boolean {
  if (!polygon.length || !pointInRing(p, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(p, hole));
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function polygons(g: Geometry): Position[][][] {
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

/** Is the point inside the geometry, or within `radiusM` of a point/line geometry? */
export function pointAffected(p: Position, g: Geometry, radiusM = 0): boolean {
  switch (g.type) {
    case "Point":
      return distanceKm(toPoint(p), toPoint(g.coordinates)) * 1000 <= radiusM;
    case "LineString":
      return g.coordinates.slice(1).some((b, i) => pointSegmentDistanceM(p, g.coordinates[i], b) <= radiusM);
    case "Polygon":
    case "MultiPolygon":
      return polygons(g).some((poly) => pointInPolygon(p, poly));
  }
}

/** Does the segment a–b pass through the geometry (or within radiusM of a point/line)? */
export function segmentAffected(a: Position, b: Position, g: Geometry, radiusM = 0): boolean {
  switch (g.type) {
    case "Point":
      return pointSegmentDistanceM(g.coordinates, a, b) <= radiusM;
    case "LineString":
      return g.coordinates.slice(1).some((d, i) => {
        const c = g.coordinates[i];
        return segmentsIntersect(a, b, c, d) || Math.min(pointSegmentDistanceM(c, a, b), pointSegmentDistanceM(d, a, b)) <= radiusM;
      });
    case "Polygon":
    case "MultiPolygon":
      return polygons(g).some(
        (poly) =>
          pointInPolygon(a, poly) ||
          pointInPolygon(b, poly) ||
          poly[0].slice(1).some((d, i) => segmentsIntersect(a, b, poly[0][i], d)),
      );
  }
}

export function pathAffected(path: Position[], g: Geometry, radiusM = 0): boolean {
  if (path.length === 1) return pointAffected(path[0], g, radiusM);
  return path.slice(1).some((b, i) => segmentAffected(path[i], b, g, radiusM));
}

/** Representative point for labelling/markers. */
export function centroid(g: Geometry): Position {
  switch (g.type) {
    case "Point":
      return g.coordinates;
    case "LineString":
      return g.coordinates[Math.floor(g.coordinates.length / 2)];
    case "Polygon":
    case "MultiPolygon": {
      const ring = polygons(g)[0][0];
      const pts = ring.slice(0, -1).length ? ring.slice(0, -1) : ring;
      return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    }
  }
}

/** Minimum distance in km between the representative points of two geometries (0 if either contains the other's centre). */
export function geometryDistanceKm(a: Geometry, b: Geometry): number {
  const ca = centroid(a);
  const cb = centroid(b);
  if (pointAffected(ca, b) || pointAffected(cb, a)) return 0;
  return distanceKm(toPoint(ca), toPoint(cb));
}

/** Bounding box [minLng, minLat, maxLng, maxLat], optionally padded by metres. */
export function bbox(g: Geometry, padM = 0): [number, number, number, number] {
  const pts: Position[] =
    g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : polygons(g).flatMap((poly) => poly[0]);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const dLat = padM / 111_320;
  const dLng = padM / (111_320 * Math.cos((((minY + maxY) / 2) * Math.PI) / 180));
  return [minX - dLng, minY - dLat, maxX + dLng, maxY + dLat];
}

/** Circle approximated as a polygon (for drawing point effects and for route avoid-areas). */
export function circlePolygon(center: Position, radiusM: number, steps = 24): Geometry {
  const coords: Position[] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(t), center[1] + dLat * Math.sin(t)]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

const isPos = (p: unknown): p is Position => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 180 && Math.abs(p[1] as number) <= 90;
const isRing = (r: unknown): r is Position[] => Array.isArray(r) && r.length >= 4 && r.every(isPos);

/** Structural check for untrusted GeoJSON (feeds): anything else is dropped, never thrown on later. */
export function isValidGeometry(g: unknown): g is Geometry {
  if (!g || typeof g !== "object") return false;
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown };
  switch (type) {
    case "Point":
      return isPos(coordinates);
    case "LineString":
      return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPos);
    case "Polygon":
      return Array.isArray(coordinates) && coordinates.length >= 1 && coordinates.every(isRing);
    case "MultiPolygon":
      return Array.isArray(coordinates) && coordinates.length >= 1 && coordinates.every((poly) => Array.isArray(poly) && poly.length >= 1 && poly.every(isRing));
    default:
      return false;
  }
}

/** Merge polygon geometries into one (Multi)Polygon; anything else is ignored. */
export function mergePolygons(geoms: (Geometry | null | undefined)[]): Geometry | null {
  const polys = geoms.filter((g): g is Geometry => !!g && (g.type === "Polygon" || g.type === "MultiPolygon") && isValidGeometry(g));
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0];
  return {
    type: "MultiPolygon",
    coordinates: polys.flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [])),
  };
}
