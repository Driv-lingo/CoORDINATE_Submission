import type { Geometry, OperationalEvent, Position } from "@/domain/ops";
import { alertType, capSeverity, fetchText, isoOrUndef, liveEvent, type LiveProvider } from "./types";

/**
 * IPAWS (Integrated Public Alert & Warning System) — Tier 2, access-dependent.
 *
 * IPAWS-OPEN requires FEMA authorization. When an authorized CAP 1.2 feed URL
 * is configured (IPAWS_CAP_FEED_URL) this adapter parses it; otherwise the
 * provider reports PARTNER_REQUIRED. NWS copies of the same alert merge with
 * the NWS event during correlation (same type, same area).
 */

const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i").exec(xml)?.[1]?.trim();
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "gi"))].map((m) => m[1].trim());
const unescape = (s?: string) => s?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** CAP polygon: "lat,lon lat,lon ..." (first = last). */
function capPolygon(s: string): Position[] | null {
  const pts = s
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((xy) => xy.length === 2 && xy.every(Number.isFinite))
    .map(([lat, lon]) => [lon, lat] as Position);
  return pts.length >= 4 ? pts : null;
}

/** Pure parser for one or more CAP 1.2 <alert> documents — exported for tests. */
export function parseCapAlerts(xml: string, now: Date): OperationalEvent[] {
  const out: OperationalEvent[] = [];
  const alerts = tags(xml, "alert");
  for (const a of alerts.length ? alerts : [xml]) {
    if ((tag(a, "status") ?? "Actual") !== "Actual") continue;
    if (tag(a, "msgType") === "Cancel") continue;
    const id = tag(a, "identifier");
    for (const info of tags(a, "info")) {
      try {
      const event = unescape(tag(info, "event"));
      if (!event) continue;
      const rings = tags(info, "polygon").map(capPolygon).filter((r): r is Position[] => !!r);
      if (!rings.length) continue;
      const geometry: Geometry = rings.length === 1 ? { type: "Polygon", coordinates: [rings[0]] } : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) };
      const expires = isoOrUndef(tag(info, "expires"));
      if (expires && new Date(expires) <= now) continue;
      const { type, effects } = alertType(event);
      out.push(
        liveEvent({
          id: `ipaws-${id ?? event}-${out.length}`,
          type,
          category: "ALERT",
          sourceId: "ipaws",
          sourceName: `IPAWS — ${unescape(tag(info, "senderName")) ?? unescape(tag(a, "sender")) ?? "alerting authority"}`,
          sourceType: "IPAWS",
          originalId: id,
          authorityLevel: "AUTHORITATIVE_ALERT",
          verificationStatus: "AUTHORITATIVE",
          title: `${event}${tag(info, "areaDesc") ? ` — ${unescape(tag(info, "areaDesc"))}` : ""}`,
          description: unescape(tag(info, "headline")),
          geometry,
          severity: capSeverity(tag(info, "severity")),
          urgency: tag(info, "urgency"),
          certainty: tag(info, "certainty"),
          eventTime: isoOrUndef(tag(a, "sent")),
          startsAt: isoOrUndef(tag(info, "onset")) ?? isoOrUndef(tag(info, "effective")),
          expiresAt: expires,
          fetchedAt: now.toISOString(),
          effects,
        }, { raw: info, sourceUpdatedAt: isoOrUndef(tag(a, "sent")) }),
      );
      } catch {
        // One malformed item never takes down the whole feed.
      }
    }
  }
  return out;
}

export const ipawsProvider: LiveProvider = {
  id: "ipaws",
  name: "IPAWS public alerts (CAP)",
  category: "ALERTS",
  tier: 2,
  liveState: "LIVE",
  pollSeconds: 120,
  describes: "Authoritative for public warnings issued by alerting authorities (evacuation, shelter-in-place, hazmat).",
  unavailable: () => (process.env.IPAWS_CAP_FEED_URL ? null : { state: "PARTNER_REQUIRED", detail: "IPAWS-OPEN access requires FEMA authorization. Set IPAWS_CAP_FEED_URL to an authorized CAP 1.2 feed." }),
  async fetchEvents(now) {
    const xml = await fetchText(process.env.IPAWS_CAP_FEED_URL!, { headers: { Accept: "application/xml, application/cap+xml, application/atom+xml" } });
    return parseCapAlerts(xml, now);
  },
};
