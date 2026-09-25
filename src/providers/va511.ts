import type { CameraResource, Geometry, OperationalEffect, OperationalEvent, OperationalEventType, Position } from "@/domain/ops";
import { asArray, fetchJson, inBbox, isoOrUndef, liveEvent, LIVE_WS, num, operationBbox, pick, str, type LiveProvider } from "./types";

/**
 * Virginia 511 / VDOT — Tier 1 once a feed is configured.
 *
 * VDOT publishes incident, lane-closure and work-zone data through the
 * SmarterRoads data portal (free registration, token-based). Feed URLs vary by
 * dataset, so the URL and token are configuration:
 *
 *   VA511_FEED_URL       GeoJSON / WZDx v4 FeatureCollection of events
 *   VA511_API_TOKEN      appended as ?token= (or sent as a header, see below)
 *   VDOT_CAMERA_FEED_URL GeoJSON / JSON list of traffic cameras
 *
 * The parser understands WZDx v4 (core_details, vehicle_impact) and common
 * 511 field names. It is not exercised against the live endpoints from the
 * development sandbox (egress is blocked); see docs/DATA_SOURCES.md.
 */

function withToken(url: string): { url: string; headers: Record<string, string> } {
  const token = process.env.VA511_API_TOKEN?.trim();
  if (!token) return { url, headers: {} };
  if (process.env.VA511_TOKEN_HEADER?.trim()) return { url, headers: { [process.env.VA511_TOKEN_HEADER.trim()]: token } };
  const u = new URL(url);
  u.searchParams.set("token", token);
  return { url: u.toString(), headers: {} };
}

function classify(text: string, impact: string | undefined): { type: OperationalEventType; effect: OperationalEffect } {
  const t = `${text} ${impact ?? ""}`.toLowerCase();
  const full = /all[- ]lanes[- ]closed|road closed|full closure|closed in both directions|both directions closed|all lanes blocked|impassable/.test(t);
  const type: OperationalEventType = /crash|collision|accident|vehicle fire|disabled/.test(t)
    ? "TRAFFIC_CRASH"
    : /flood|high water|water over/.test(t)
      ? "FLOODING"
      : /work zone|work-zone|construction|maintenance|paving|roadwork/.test(t)
        ? "ROAD_WORK"
        : /closed|closure/.test(t)
          ? "ROAD_CLOSURE"
          : /tree|debris|downed|hazard|ice|snow/.test(t)
            ? "ROAD_HAZARD"
            : "PUBLIC_SAFETY_INCIDENT";
  return { type, effect: full ? { kind: "BLOCKS_ROAD", radiusM: 150 } : { kind: "SLOWS_ROAD", radiusM: 250, delayMinutes: 5 } };
}

const firstPosition = (g: Geometry): Position | undefined => (g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates[0] : undefined);

/** Pure parser — exported for tests. */
export function parseVa511(data: unknown, now: Date): OperationalEvent[] {
  const bb = operationBbox();
  const features = asArray<{ id?: string; geometry?: Geometry | { type: "MultiPoint"; coordinates: Position[] }; properties?: Record<string, unknown> }>((data as { features?: unknown })?.features);
  const out: OperationalEvent[] = [];
  for (const f of features) {
    try {
    let g = f.geometry as Geometry | { type: "MultiPoint"; coordinates: Position[] } | undefined;
    if (!g) continue;
    if (g.type === "MultiPoint") g = { type: "LineString", coordinates: g.coordinates };
    if (g.type !== "Point" && g.type !== "LineString") continue;
    const pos = firstPosition(g);
    if (!pos || !inBbox(pos[0], pos[1], bb)) continue;
    const p = f.properties ?? {};
    const core = (pick(p, "core_details") as Record<string, unknown> | undefined) ?? p;
    const description = str(pick(core, "description", "headline", "Description", "event_description")) ?? "";
    const eventType = str(pick(core, "event_type", "eventType", "type", "category")) ?? "";
    const roads = pick(core, "road_names", "roadNames") as string[] | undefined;
    const road = roads?.[0] ?? str(pick(p, "roadway_name", "RoadwayName", "roadway", "road", "route"));
    const impact = str(pick(p, "vehicle_impact", "lanes_status", "LanesStatus", "closure"));
    const { type, effect } = classify(`${eventType} ${description}`, impact);
    const end = isoOrUndef(pick(p, "end_date", "PlannedEndDate", "endTime", "end"));
    if (end && new Date(end) <= now) continue;
    const id = str(f.id) ?? str(pick(core, "id")) ?? str(pick(p, "id", "EventId")) ?? `${pos[0]},${pos[1]}`;
    out.push(
      liveEvent({
        id: `va511-${id}`,
        type,
        category: "TRAFFIC",
        sourceId: "va511",
        sourceName: "Virginia 511 / VDOT",
        sourceType: "VIRGINIA_511",
        originalId: id,
        authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
        verificationStatus: "AUTHORITATIVE",
        title: [description || eventType.replace(/[-_]/g, " ") || "Road event", road && !description.includes(road) ? road : undefined].filter(Boolean).join(" — ").slice(0, 160),
        roadName: road,
        geometry: g,
        eventTime: isoOrUndef(pick(core, "update_date") ?? pick(p, "start_date", "StartDate", "startTime", "start")),
        expiresAt: end,
        fetchedAt: now.toISOString(),
        effects: [effect],
      }, { raw: f, sourceUpdatedAt: isoOrUndef(pick(p, "update_date", "updateTime", "LastUpdated", "last_updated", "start_date")) }),
    );
    } catch {
      // One malformed item never takes down the whole feed.
    }
  }
  return out;
}

/** Pure camera-list parser — exported for tests. */
export function parseCameras(data: unknown): CameraResource[] {
  const bb = operationBbox();
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : asArray<{ id?: string; geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }>((data as { features?: unknown })?.features).map((f) => ({
        ...f.properties,
        id: f.id ?? f.properties?.id,
        lng: f.geometry?.coordinates?.[0],
        lat: f.geometry?.coordinates?.[1],
      }));
  const out: CameraResource[] = [];
  for (const r of rows) {
    try {
    const lat = num(pick(r, "lat", "latitude", "y"));
    const lng = num(pick(r, "lng", "lon", "longitude", "x"));
    if (lat === undefined || lng === undefined || !inBbox(lng, lat, bb)) continue;
    const id = str(pick(r, "id", "camera_id", "cameraId")) ?? `${lat},${lng}`;
    const img = str(pick(r, "image_url", "imageUrl", "snapshot", "snapshotUrl", "url", "jpeg_url"));
    out.push({
      id: `vdot-cam-${id}`,
      workspaceId: LIVE_WS,
      mode: "LIVE",
      simulated: false,
      name: str(pick(r, "name", "description", "title", "location")) ?? `VDOT camera ${id}`,
      sourceType: "PUBLIC_TRAFFIC_CAMERA",
      provider: "VDOT traffic cameras",
      location: { lat, lng },
      status: img && img.startsWith("https://") ? "ONLINE" : "UNKNOWN",
      snapshotUrl: img && img.startsWith("https://") ? img : undefined,
      accessLog: [],
    });
    } catch {
      // One malformed item never takes down the whole feed.
    }
  }
  return out.slice(0, 400);
}

export const va511Provider: LiveProvider = {
  id: "va511",
  name: "Virginia 511 / VDOT incidents & closures",
  category: "TRANSPORTATION",
  tier: 1,
  liveState: "LIVE",
  pollSeconds: 120,
  describes: "Authoritative operational data for Virginia road closures, crashes and work zones.",
  unavailable: () => (process.env.VA511_FEED_URL ? null : { state: "NOT_CONFIGURED", detail: "Register with VDOT SmarterRoads and set VA511_FEED_URL (and VA511_API_TOKEN)." }),
  async fetchEvents(now) {
    const { url, headers } = withToken(process.env.VA511_FEED_URL!);
    return parseVa511(await fetchJson(url, { headers }), now);
  },
};

export const vdotCameraProvider: LiveProvider = {
  id: "vdot-cameras",
  name: "VDOT traffic cameras",
  category: "CAMERAS",
  tier: 1,
  liveState: "LIVE",
  pollSeconds: 900,
  describes: "Public traffic-camera snapshots. Evidence only — observations need corroboration.",
  unavailable: () => (process.env.VDOT_CAMERA_FEED_URL ? null : { state: "NOT_CONFIGURED", detail: "Set VDOT_CAMERA_FEED_URL to a VDOT camera list (SmarterRoads)." }),
  async fetchCameras() {
    const { url, headers } = withToken(process.env.VDOT_CAMERA_FEED_URL!);
    return parseCameras(await fetchJson(url, { headers }));
  },
};
