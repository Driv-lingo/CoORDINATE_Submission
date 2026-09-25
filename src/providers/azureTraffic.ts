import { config } from "@/config";
import type { Geometry, OperationalEffect, OperationalEvent, OperationalEventType, Position } from "@/domain/ops";
import { asArray, fetchJson, inBbox, isoOrUndef, liveEvent, num, operationBbox, pick, str, type LiveProvider } from "./types";

/**
 * Azure Maps Traffic incidents — Tier 1 when AZURE_MAPS_KEY is set.
 *
 * Default: Traffic Incident Detail v1.0 (EPSG:4326, clusters expanded).
 * AZURE_MAPS_TRAFFIC_API_VERSION may select a newer GeoJSON version; the
 * parser accepts both the v1 `tm.poi[]` shape and GeoJSON features.
 */

const ICON: Record<number, { type: OperationalEventType; blocks?: boolean }> = {
  1: { type: "TRAFFIC_CRASH" },
  2: { type: "ROAD_HAZARD" },
  3: { type: "ROAD_HAZARD" },
  4: { type: "ROAD_HAZARD" },
  5: { type: "ROAD_HAZARD" },
  6: { type: "CONGESTION" },
  7: { type: "ROAD_CLOSURE" },
  8: { type: "ROAD_CLOSURE", blocks: true },
  9: { type: "ROAD_WORK" },
  10: { type: "ROAD_HAZARD" },
  11: { type: "FLOODING" },
  14: { type: "ROAD_HAZARD" },
};
const NAMED: Record<string, { type: OperationalEventType; blocks?: boolean }> = {
  accident: { type: "TRAFFIC_CRASH" },
  jam: { type: "CONGESTION" },
  congestion: { type: "CONGESTION" },
  laneclosed: { type: "ROAD_CLOSURE" },
  laneclosure: { type: "ROAD_CLOSURE" },
  lanerestriction: { type: "ROAD_CLOSURE" },
  roadclosed: { type: "ROAD_CLOSURE", blocks: true },
  roadclosure: { type: "ROAD_CLOSURE", blocks: true },
  roadworks: { type: "ROAD_WORK" },
  flooding: { type: "FLOODING" },
  dangerousconditions: { type: "ROAD_HAZARD" },
};

function effectFor(kind: { type: OperationalEventType; blocks?: boolean }, magnitude: number | undefined, delaySec: number | undefined): OperationalEffect {
  // Magnitude 4 = "undefined", which Azure Maps uses for closures.
  if (kind.blocks || magnitude === 4) return { kind: "BLOCKS_ROAD", radiusM: 120 };
  return { kind: "SLOWS_ROAD", radiusM: 200, delayMinutes: Math.max(1, Math.round((delaySec ?? (magnitude ?? 1) * 120) / 60)) };
}

type V1Poi = { id?: string; p?: { x?: number; y?: number }; ic?: number; ty?: number; d?: string; c?: string; f?: string; t?: string; r?: string; dl?: number; sd?: string; ed?: string; cpoi?: V1Poi[] };

/** Pure parser — exported for tests. */
export function parseAzureTraffic(data: unknown, now: Date): OperationalEvent[] {
  const out: OperationalEvent[] = [];
  const bb = operationBbox();
  const push = (id: string, kind: { type: OperationalEventType; blocks?: boolean }, geometry: Geometry, title: string, extra: { magnitude?: number; delay?: number; road?: string; start?: string; end?: string; raw?: unknown }) => {
    out.push(
      liveEvent({
        id: `azm-${id}`,
        type: kind.type,
        category: "TRAFFIC",
        sourceId: "azure-maps-traffic",
        sourceName: "Azure Maps Traffic",
        sourceType: "AZURE_MAPS_TRAFFIC",
        originalId: id,
        authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
        verificationStatus: "AUTHORITATIVE",
        title,
        roadName: extra.road,
        geometry,
        eventTime: extra.start,
        expiresAt: extra.end && new Date(extra.end) > now ? extra.end : undefined,
        fetchedAt: now.toISOString(),
        effects: [effectFor(kind, extra.magnitude, extra.delay)],
      }, { raw: extra.raw ?? { id, title }, sourceUpdatedAt: extra.start }),
    );
  };

  // v1.0: { tm: { poi: [...] } }
  const pois = (data as { tm?: { poi?: V1Poi[] } })?.tm?.poi;
  if (Array.isArray(pois)) {
    const flat = pois.filter((p) => p && typeof p === "object").flatMap((p) => (p.ic === 13 && Array.isArray(p.cpoi) ? p.cpoi : [p]));
    for (const p of flat) {
      try {
      const x = num(p.p?.x);
      const y = num(p.p?.y);
      if (x === undefined || y === undefined || !inBbox(x, y, bb)) continue;
      const kind = ICON[p.ic ?? 0];
      if (!kind) continue;
      const road = str(p.r);
      const title = [str(p.d) ?? kind.type.replace(/_/g, " ").toLowerCase(), road, p.f && p.t ? `${p.f} → ${p.t}` : undefined].filter(Boolean).join(" — ");
      push(p.id ?? `${x},${y}`, kind, { type: "Point", coordinates: [x, y] }, title, { magnitude: p.ty, delay: p.dl, road, start: isoOrUndef(p.sd), end: isoOrUndef(p.ed), raw: p });
      } catch {
        // One malformed item never takes down the whole feed.
      }
    }
    return out;
  }

  // GeoJSON variants.
  const features = asArray<{ id?: string; geometry?: Geometry; properties?: Record<string, unknown> }>((data as { features?: unknown })?.features);
  for (const f of features) {
    try {
    const props = f.properties ?? {};
    const g = f.geometry;
    if (!g || (g.type !== "Point" && g.type !== "LineString")) continue;
    const first: Position = g.type === "Point" ? g.coordinates : g.coordinates[0];
    if (!first || !inBbox(first[0], first[1], bb)) continue;
    const icon = num(pick(props, "iconCategory", "icon"));
    const named = str(pick(props, "incidentType", "type"))?.toLowerCase().replace(/[^a-z]/g, "");
    const kind = (named && NAMED[named]) ?? (icon !== undefined ? ICON[icon] : undefined) ?? (pick(props, "isRoadClosed", "roadClosed") === true ? { type: "ROAD_CLOSURE" as const, blocks: true } : undefined);
    if (!kind) continue;
    const events = pick(props, "events") as { description?: string }[] | undefined;
    const road = (pick(props, "roadNumbers") as string[] | undefined)?.[0] ?? str(pick(props, "roadName", "road"));
    const title = [str(pick(props, "description")) ?? events?.[0]?.description ?? kind.type.replace(/_/g, " ").toLowerCase(), road].filter(Boolean).join(" — ");
    push(str(f.id) ?? str(pick(props, "id")) ?? `${first[0]},${first[1]}`, kind, g, title, {
      magnitude: num(pick(props, "magnitudeOfDelay", "magnitude")),
      delay: num(pick(props, "delay", "delayInSeconds")),
      road,
      start: isoOrUndef(pick(props, "startTime", "start")),
      end: isoOrUndef(pick(props, "endTime", "end")),
    });
    } catch {
      // One malformed item never takes down the whole feed.
    }
  }
  return out;
}

export const azureTrafficProvider: LiveProvider = {
  id: "azure-maps-traffic",
  name: "Azure Maps Traffic incidents",
  category: "TRAFFIC",
  tier: 1,
  liveState: "LIVE",
  pollSeconds: 120,
  describes: "Authoritative operational data for crashes, closures, congestion and travel delay.",
  unavailable: () => (config().maps ? null : { state: "NOT_CONFIGURED", detail: "Set AZURE_MAPS_KEY to enable traffic incidents and traffic-aware routing." }),
  async fetchEvents(now) {
    const key = config().maps!.key;
    const [w, s, e, n] = operationBbox();
    const version = process.env.AZURE_MAPS_TRAFFIC_API_VERSION?.trim() || "1.0";
    const url =
      version === "1.0"
        ? `https://atlas.microsoft.com/traffic/incident/detail/json?api-version=1.0&style=s3&boundingbox=${s},${w},${n},${e}&boundingZoom=11&trafficmodelid=-1&projection=EPSG4326&expandCluster=true&language=en-US`
        : `https://atlas.microsoft.com/traffic/incident?api-version=${encodeURIComponent(version)}&bbox=${w},${s},${e},${n}`;
    return parseAzureTraffic(await fetchJson(url, { headers: { "subscription-key": key } }), now);
  },
};
