import type { OperationalEvent } from "@/domain/ops";
import { asArray, fetchJson, inBbox, isoOrUndef, liveEvent, num, pick, str, type LiveProvider } from "./types";

/**
 * Public CAD / "active calls" feeds published by localities — Tier 1 where a
 * locality publishes one and its terms permit reuse (PUBLIC_CAD_FEED_URL).
 *
 * CAD data is AWARENESS, not civilian authority: every event is ADVISORY and
 * can never route or hold a volunteer on its own. Only coordinates the source
 * publishes are used; if a record's location is withheld or redacted it is
 * shown as area-only and is NOT geocoded or reconstructed.
 */

const REDACTED = /redact|withheld|restricted|confidential|\bn\/a\b/i;

/** Pure parser — exported for tests. */
export function parsePublicCad(data: unknown, now: Date): OperationalEvent[] {
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : Array.isArray((data as { data?: unknown })?.data)
      ? ((data as { data: Record<string, unknown>[] }).data)
      : asArray<{ geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }>((data as { features?: unknown })?.features).map((f) => ({
          ...f.properties,
          longitude: f.geometry?.coordinates?.[0],
          latitude: f.geometry?.coordinates?.[1],
        }));
  const out: OperationalEvent[] = [];
  const latency = num(process.env.PUBLIC_CAD_DELAY_SECONDS) ?? 600;
  for (const r of rows.slice(0, 500)) {
    try {
    const lat = num(pick(r, "latitude", "lat", "y"));
    const lng = num(pick(r, "longitude", "lon", "lng", "x"));
    if (lat === undefined || lng === undefined || !inBbox(lng, lat)) continue;
    const nature = str(pick(r, "nature", "call_type", "calltype", "type", "incident_type", "problem", "description")) ?? "Public-safety activity";
    const address = str(pick(r, "address", "location", "block", "block_address"));
    const redacted = REDACTED.test(nature) || (address ? REDACTED.test(address) : false);
    const id = str(pick(r, "id", "incident_number", "incidentnumber", "call_id", "event_number")) ?? `${lat},${lng},${nature}`;
    const at = isoOrUndef(pick(r, "received", "call_time", "datetime", "time", "date", "created"));
    out.push(
      liveEvent({
        id: `cad-${id}`,
        type: /fire/i.test(nature) ? "FIRE" : /hazmat|hazardous|gas leak/i.test(nature) ? "HAZMAT" : /crash|collision|accident|mva/i.test(nature) ? "TRAFFIC_CRASH" : "PUBLIC_SAFETY_INCIDENT",
        category: "PUBLIC_SAFETY",
        sourceId: "public-cad",
        sourceName: process.env.PUBLIC_CAD_SOURCE_NAME?.trim() || "Public CAD feed",
        sourceType: "PUBLIC_CAD",
        originalId: id,
        authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
        verificationStatus: "AUTHORITATIVE",
        title: redacted ? "Public-safety activity (details withheld by source)" : `${nature}${address ? ` — ${address}` : ""}`.slice(0, 140),
        geometry: { type: "Point", coordinates: [lng, lat] },
        publicDetailLevel: redacted ? "AREA_ONLY" : "FULL",
        latencySeconds: latency,
        eventTime: at,
        fetchedAt: now.toISOString(),
        // Awareness only — CAD never directs civilians.
        effects: [{ kind: "ADVISORY" }],
      }, { raw: r, sourceUpdatedAt: at }),
    );
    } catch {
      // One malformed item never takes down the whole feed.
    }
  }
  return out;
}

export const publicCadProvider: LiveProvider = {
  id: "public-cad",
  name: "Public CAD / active-calls feed",
  category: "PUBLIC_SAFETY",
  tier: 1,
  liveState: "LIVE_DELAYED",
  pollSeconds: 120,
  describes: "Delayed public-safety activity published by a locality. Awareness only — never directs civilians.",
  unavailable: () => (process.env.PUBLIC_CAD_FEED_URL ? null : { state: "NOT_CONFIGURED", detail: "Set PUBLIC_CAD_FEED_URL to a locality's published active-calls feed (where its terms permit reuse)." }),
  async fetchEvents(now) {
    return parsePublicCad(await fetchJson(process.env.PUBLIC_CAD_FEED_URL!), now);
  },
};
