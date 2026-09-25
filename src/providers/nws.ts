import type { Geometry, OperationalEvent } from "@/domain/ops";
import { asArray, alertType, capSeverity, fetchJson, isoOrUndef, liveEvent, mergePolygons, str, type LiveProvider } from "./types";

/**
 * National Weather Service active alerts (api.weather.gov) — Tier 1, public.
 *
 *   GET https://api.weather.gov/alerts/active?area=VA   (GeoJSON)
 *
 * Many alerts carry no polygon, only forecast/county zones; those zones are
 * fetched (and cached for a day) so every alert has an area to intersect.
 * Test and exercise messages and cancellations are ignored.
 */

/** NWS_API_BASE exists only for local testing against a recorded feed. */
const BASE = process.env.NWS_API_BASE?.trim() || "https://api.weather.gov";
const MAX_ZONE_FETCHES = 30;
const ZONE_TTL_MS = 24 * 3600e3;
const zoneCache = new Map<string, { at: number; geometry: Geometry | null }>();

export interface NwsFeature {
  id?: string;
  geometry?: Geometry | null;
  properties?: {
    "@id"?: string;
    id?: string;
    event?: string;
    headline?: string;
    description?: string;
    instruction?: string;
    areaDesc?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    status?: string;
    messageType?: string;
    sent?: string;
    effective?: string;
    onset?: string;
    expires?: string;
    ends?: string;
    senderName?: string;
    affectedZones?: string[];
  };
}

function userAgent() {
  return process.env.NWS_USER_AGENT?.trim() || "CoORDINATE community-coordination prototype (github.com/driv-lingo/coordinate)";
}

/** Pure parser — exported for tests. `zones` resolves zone URLs to geometry. */
export function parseNwsAlerts(data: unknown, now: Date, zones: (url: string) => Geometry | null | undefined = () => undefined): OperationalEvent[] {
  const features = asArray<NwsFeature>((data as { features?: unknown })?.features).filter((f) => f && typeof f === "object");
  const out: OperationalEvent[] = [];
  for (const f of features) {
    try {
    const p = f.properties ?? {};
    if (p.status && p.status !== "Actual") continue;
    if (p.messageType === "Cancel") continue;
    const event = str(p.event);
    if (!event) continue;
    const geometry = mergePolygons([f.geometry]) ?? mergePolygons(asArray<string>(p.affectedZones).map((z) => zones(z)));
    if (!geometry) continue;
    const { type, effects } = alertType(event);
    const expires = isoOrUndef(p.ends) ?? isoOrUndef(p.expires);
    if (expires && new Date(expires) <= now) continue;
    out.push(
      liveEvent({
        id: `nws-${(p.id ?? f.id ?? `${event}-${p.sent}`).split("/").pop()}`,
        type,
        category: type === "WEATHER_ADVISORY" ? "WEATHER" : "ALERT",
        sourceId: "nws",
        sourceName: `National Weather Service${p.senderName ? ` — ${p.senderName}` : ""}`,
        sourceType: "NWS",
        originalId: p.id ?? f.id,
        authorityLevel: "AUTHORITATIVE_ALERT",
        verificationStatus: "AUTHORITATIVE",
        title: `${event}${p.areaDesc ? ` — ${p.areaDesc.split(";").slice(0, 3).join(";")}${p.areaDesc.split(";").length > 3 ? "…" : ""}` : ""}`,
        description: [p.headline, p.instruction].filter(Boolean).join(" ").slice(0, 600) || undefined,
        geometry,
        severity: capSeverity(p.severity),
        urgency: p.urgency,
        certainty: p.certainty,
        eventTime: isoOrUndef(p.sent),
        startsAt: isoOrUndef(p.onset) ?? isoOrUndef(p.effective),
        expiresAt: expires,
        fetchedAt: now.toISOString(),
        effects,
      }, { raw: f, sourceUrl: str(p["@id"]) ?? str(f.id) ?? (p.id ? `https://api.weather.gov/alerts/${p.id}` : undefined), sourceUpdatedAt: isoOrUndef(p.sent) }),
    );
    } catch {
      // One malformed item never takes down the whole feed.
    }
  }
  return out;
}

async function zoneGeometry(url: string): Promise<Geometry | null> {
  const hit = zoneCache.get(url);
  if (hit && Date.now() - hit.at < ZONE_TTL_MS) return hit.geometry;
  const data = (await fetchJson(url, { headers: { "User-Agent": userAgent(), Accept: "application/geo+json" }, timeoutMs: 6000 })) as { geometry?: Geometry | null };
  const geometry = mergePolygons([data.geometry]);
  zoneCache.set(url, { at: Date.now(), geometry });
  return geometry;
}

export const nwsProvider: LiveProvider = {
  id: "nws",
  name: "National Weather Service alerts",
  category: "WEATHER",
  tier: 1,
  liveState: "LIVE",
  pollSeconds: 60,
  describes: "Authoritative for weather warnings (tornado, severe thunderstorm, flash flood, wind).",
  unavailable: () => (process.env.NWS_ENABLED === "false" ? { state: "NOT_CONFIGURED", detail: "Disabled by NWS_ENABLED=false." } : null),
  async fetchEvents(now) {
    const area = process.env.NWS_AREA?.trim() || "VA";
    const data = (await fetchJson(`${BASE}/alerts/active?area=${encodeURIComponent(area)}`, { headers: { "User-Agent": userAgent(), Accept: "application/geo+json" } })) as { features?: NwsFeature[] };
    // Resolve zone geometry for alerts that have none (bounded per poll).
    const needed = new Set<string>();
    for (const f of asArray<NwsFeature>(data.features)) if (f && !f.geometry) for (const z of asArray<string>(f.properties?.affectedZones).slice(0, 12)) if (typeof z === "string" && !zoneCache.has(z)) needed.add(z);
    await Promise.allSettled([...needed].slice(0, MAX_ZONE_FETCHES).map((z) => zoneGeometry(z)));
    return parseNwsAlerts(data, now, (z) => zoneCache.get(z)?.geometry);
  },
};
