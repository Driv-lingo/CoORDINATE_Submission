import type {
  AuthorityLevel,
  EffectArea,
  EventCluster,
  EvidenceItem,
  Geometry,
  OperationalEffect,
  OperationalEvent,
  OperationalEventType,
  VerificationStatus,
} from "@/domain/ops";
import { AUTHORITY_LEVELS } from "@/domain/ops";
import { centroid, geometryDistanceKm, mergePolygons, pointAffected } from "./geometry";
import type { Restriction, Slowdown } from "./routing";

/**
 * Multi-source correlation with provenance.
 *
 * Deterministic signals only — geography, time, type compatibility and source
 * authority. (A language model may help summarise a cluster; it never decides
 * membership or actionability.)
 *
 * Actionability rules:
 *  A1  An effect is actionable if its cluster contains a non-stale member from an
 *      authoritative/verified source (alert, operational data, verified partner,
 *      coordinator-confirmed).
 *  A2  Otherwise it is actionable only if CORROBORATED: at least two independent
 *      non-stale sources, at least one of which is a community report or better.
 *  A3  Media, machine-derived (camera AI) and unverified open-source items alone are
 *      never actionable — they create a review item, not an operational change.
 *  A4  Expired events are dropped; stale events are shown but never actionable.
 */

/** The same rules as data, rendered on the "How it works" page. */
export const CORRELATION_RULES = [
  { id: "A1", title: "Official sources act alone", description: "A current alert, official operational feed, verified partner or coordinator confirmation makes a condition actionable." },
  { id: "A2", title: "Otherwise, corroboration", description: "Two independent current sources, at least one a community report or better, make it actionable." },
  { id: "A3", title: "Weak sources never act alone", description: "News, social posts and camera-AI observations only create a review item — they never close a road or hold a mission by themselves." },
  { id: "A4", title: "Staleness and expiry", description: "Expired items are dropped; stale items are shown greyed out and are never actionable." },
];

export const AUTHORITY_RANK: Record<AuthorityLevel, number> = Object.fromEntries(AUTHORITY_LEVELS.map((a, i) => [a, i])) as Record<AuthorityLevel, number>;
const ACTIONABLE_ALONE = new Set<AuthorityLevel>(["AUTHORITATIVE_ALERT", "AUTHORITATIVE_OPERATIONAL_DATA", "VERIFIED_PARTNER", "COORDINATOR_CONFIRMED"]);

/** Minutes after which an event without an explicit expiry is considered stale. */
export const STALE_AFTER_MIN: Partial<Record<OperationalEventType, number>> = {
  CAMERA_OBSERVATION: 30,
  CONGESTION: 60,
  TRAFFIC_CRASH: 180,
  COMMUNITY_REPORT: 240,
  ROAD_HAZARD: 240,
  NEWS_REPORT: 360,
  PUBLIC_SAFETY_INCIDENT: 240,
  FLOODING: 360,
  ROAD_CLOSURE: 720,
  ROAD_WORK: 1440,
};
const DEFAULT_STALE_MIN = 360;

export function isExpired(e: OperationalEvent, now: Date): boolean {
  return !!e.expiresAt && new Date(e.expiresAt) <= now;
}

/**
 * Age is measured from the most recent of the event time and the last time a
 * source reported it: a closure that started yesterday but is still in the
 * latest feed poll is current.
 */
const POINT_IN_TIME_SOURCES = new Set(["COMMUNITY", "NEWS", "PUBLIC_CAMERA", "PRIVATE_CAMERA"]);

export function isStale(e: OperationalEvent, now: Date): boolean {
  if (isExpired(e, now)) return true;
  if (e.expiresAt) return false;
  // Observations and reports age from when they were made; ongoing feed conditions from the last poll that still listed them.
  const observed = Date.parse(e.eventTime ?? e.fetchedAt) || 0;
  const pointInTime = POINT_IN_TIME_SOURCES.has(e.sourceType) || e.type === "CAMERA_OBSERVATION";
  const t = pointInTime ? observed : Math.max(observed, Date.parse(e.fetchedAt) || 0);
  return now.getTime() - t > (STALE_AFTER_MIN[e.type] ?? DEFAULT_STALE_MIN) * 6e4;
}

/** Event families that may describe the same physical condition. */
const FAMILY: Record<OperationalEventType, string> = {
  TRAFFIC_CRASH: "road",
  ROAD_CLOSURE: "road",
  ROAD_HAZARD: "road",
  ROAD_WORK: "road",
  CONGESTION: "road",
  FLOODING: "road",
  CAMERA_OBSERVATION: "road",
  COMMUNITY_REPORT: "road",
  NEWS_REPORT: "road",
  PUBLIC_SAFETY_INCIDENT: "road",
  FIRE: "fire",
  HAZMAT: "fire",
  EVACUATION: "area",
  SHELTER_IN_PLACE: "area",
  UTILITY_OUTAGE: "utility",
  FLASH_FLOOD_WARNING: "warning",
  TORNADO_WARNING: "warning",
  SEVERE_THUNDERSTORM_WARNING: "warning",
  HIGH_WIND: "warning",
  WEATHER_ADVISORY: "warning",
};

/** Area alerts that lend context to point conditions inside them. */
const CONTEXT: Partial<Record<OperationalEventType, OperationalEventType[]>> = {
  FLASH_FLOOD_WARNING: ["FLOODING", "CAMERA_OBSERVATION", "COMMUNITY_REPORT", "CONGESTION"],
};

const CORRELATION_RADIUS_KM = 0.4;
const CORRELATION_WINDOW_MIN = 180;

const isArea = (g: Geometry) => g.type === "Polygon" || g.type === "MultiPolygon";
const eventTime = (e: OperationalEvent) => new Date(e.eventTime ?? e.startsAt ?? e.fetchedAt).getTime();

function effectiveAuthority(e: OperationalEvent): AuthorityLevel {
  return e.coordinatorReview?.status === "CONFIRMED" && AUTHORITY_RANK[e.authorityLevel] > AUTHORITY_RANK.COORDINATOR_CONFIRMED ? "COORDINATOR_CONFIRMED" : e.authorityLevel;
}

function independentKey(e: OperationalEvent): string {
  // Two residents are two independent sources; two items from the same feed are one.
  return e.sourceType === "COMMUNITY" ? `COMMUNITY:${e.sourceId}` : e.sourceType;
}

export function evidenceOf(e: OperationalEvent, now: Date): EvidenceItem {
  const kind = e.type.replace(/_/g, " ").toLowerCase();
  return {
    eventId: e.id,
    sourceName: e.sourceName,
    sourceType: e.sourceType,
    authorityLevel: effectiveAuthority(e),
    label: e.camera ? `${e.camera.cameraName}: ${e.camera.observationType.replace(/_/g, " ").toLowerCase()}${e.camera.machineGenerated && !e.camera.humanVerified ? " (AI observation, not independently verified)" : ""}` : `${e.title}${e.roadName && !e.title.includes(e.roadName) ? ` — ${e.roadName}` : ""} (${kind})`,
    observedAt: e.eventTime ?? e.fetchedAt,
    expiresAt: e.expiresAt,
    simulated: e.simulated,
    stale: isStale(e, now),
  };
}

/** Correlate events into clusters with provenance, status, confidence and actionable effects. */
export function correlate(events: OperationalEvent[], now: Date): EventCluster[] {
  const current = events.filter((e) => !isExpired(e, now));
  const sorted = [...current].sort((a, b) => AUTHORITY_RANK[effectiveAuthority(a)] - AUTHORITY_RANK[effectiveAuthority(b)] || a.id.localeCompare(b.id));
  const groups: OperationalEvent[][] = [];

  for (const e of sorted) {
    const fam = FAMILY[e.type];
    const home = groups.find((g) => {
      const p = g[0];
      if (FAMILY[p.type] !== fam || p.mode !== e.mode) return false;
      if (isArea(p.geometry) || isArea(e.geometry)) {
        // Area alerts merge only with the same alert type covering the same place (e.g. NWS + IPAWS copies).
        return p.type === e.type && isArea(p.geometry) && isArea(e.geometry) && pointAffected(centroid(e.geometry), p.geometry);
      }
      return geometryDistanceKm(p.geometry, e.geometry) <= CORRELATION_RADIUS_KM && Math.abs(eventTime(p) - eventTime(e)) <= CORRELATION_WINDOW_MIN * 6e4;
    });
    if (home) home.push(e);
    else groups.push([e]);
  }

  return groups.map((members) => summarize(members, current, now));
}

const isDisputed = (e: OperationalEvent) => e.coordinatorReview?.status === "DISPUTED";

function summarize(members: OperationalEvent[], all: OperationalEvent[], now: Date): EventCluster {
  const primary = members[0];
  const live = members.filter((m) => !isStale(m, now));
  // Disputed items never count — neither as a source nor as corroboration.
  const usable = live.filter((m) => !isDisputed(m));
  const authoritative = usable.filter((m) => ACTIONABLE_ALONE.has(effectiveAuthority(m)));
  const independent = new Set(usable.map(independentKey));
  const hasHumanOrBetter = usable.some((m) => AUTHORITY_RANK[effectiveAuthority(m)] <= AUTHORITY_RANK.COMMUNITY_REPORT);
  const corroborated = independent.size >= 2 && hasHumanOrBetter;
  const disputed = members.some(isDisputed) && authoritative.length === 0;

  // Context evidence: area alerts containing this point cluster.
  const context = isArea(primary.geometry)
    ? []
    : all.filter(
        (a) => isArea(a.geometry) && !isStale(a, now) && (CONTEXT[a.type] ?? []).some((t) => members.some((m) => m.type === t)) && pointAffected(centroid(primary.geometry), a.geometry),
      );
  const contextIndependent = new Set([...independent, ...context.map(independentKey)]);

  let status: VerificationStatus;
  if (live.length === 0) status = "STALE";
  else if (disputed) status = "DISPUTED";
  else if (authoritative.length) status = independent.size >= 2 ? "CORROBORATED" : "AUTHORITATIVE";
  else status = corroborated ? "CORROBORATED" : "UNVERIFIED";

  const confidence: EventCluster["confidence"] =
    (authoritative.length && contextIndependent.size >= 2) || contextIndependent.size >= 3 ? "HIGH" : authoritative.length || contextIndependent.size === 2 ? "MEDIUM" : "LOW";

  /**
   * Per-member, per-effect actionability. An effect acts if its member is
   * current, not disputed, and either official on its own (A1) or supported by
   * at least two independent sources proposing the SAME kind of effect, one of
   * them a community report or better (A2). A congestion report cannot promote
   * a news item's "road closed", and advisory-only CAD corroborates nothing.
   */
  const supportFor = (kind: OperationalEffect["kind"]) => {
    const supporters = usable.filter((o) => o.effects.some((e) => e.kind === kind));
    return new Set(supporters.map(independentKey)).size >= 2 && supporters.some((o) => AUTHORITY_RANK[effectiveAuthority(o)] <= AUTHORITY_RANK.COMMUNITY_REPORT);
  };
  const areas: EffectArea[] = [];
  const pendingEffects: EventCluster["pendingEffects"] = [];
  for (const m of members) {
    for (const eff of m.effects) {
      if (eff.kind === "ADVISORY") continue;
      const why = isStale(m, now)
        ? "Source data is stale"
        : isDisputed(m)
          ? "Disputed by a coordinator"
          : ACTIONABLE_ALONE.has(effectiveAuthority(m)) || supportFor(eff.kind)
            ? null
            : `${m.sourceName} alone is not authoritative — awaiting corroboration`;
      if (why === null) areas.push({ eventId: m.id, kind: eff.kind, geometry: m.geometry, radiusM: eff.radiusM, delayMinutes: eff.delayMinutes });
      else if (!pendingEffects.some((x) => x.effect.kind === eff.kind)) pendingEffects.push({ effect: eff, reason: why });
    }
  }
  // A closure supersedes a slowdown reported for the same place.
  const actionableAreas = areas.some((a) => a.kind === "BLOCKS_ROAD") ? areas.filter((a) => a.kind !== "SLOWS_ROAD") : areas;
  const actionableEffects: OperationalEffect[] = [];
  for (const a of actionableAreas) {
    if (!actionableEffects.some((x) => x.kind === a.kind)) actionableEffects.push({ kind: a.kind, radiusM: a.radiusM, delayMinutes: a.delayMinutes });
  }
  // Pending entries for kinds that are actionable through another member are noise.
  const pending = pendingEffects.filter((p) => !actionableEffects.some((e) => e.kind === p.effect.kind));

  const byAuthority = [...members].sort((a, b) => AUTHORITY_RANK[effectiveAuthority(a)] - AUTHORITY_RANK[effectiveAuthority(b)]);
  const title = byAuthority[0].title;
  // Display geometry: every member's area for area clusters; otherwise the strongest actionable member.
  const strongest = byAuthority.find((m) => actionableAreas.some((a) => a.eventId === m.id));
  const geometry = members.every((m) => isArea(m.geometry)) ? (mergePolygons(members.map((m) => m.geometry)) ?? primary.geometry) : (strongest ?? primary).geometry;
  const expiries = members.map((m) => m.expiresAt).filter(Boolean) as string[];
  return {
    id: `cl-${primary.id}`,
    title,
    type: primary.type,
    memberIds: members.map((m) => m.id),
    primaryId: primary.id,
    sourceTypes: Array.from(new Set(members.map((m) => m.sourceType))),
    status,
    confidence,
    actionableEffects,
    actionableAreas,
    pendingEffects: pending,
    geometry,
    expiresAt: expiries.length ? expiries.sort().at(-1) : undefined,
    evidence: [...members, ...context].map((m) => evidenceOf(m, now)),
  };
}

const DEFAULT_RADIUS: Partial<Record<OperationalEffect["kind"], number>> = { BLOCKS_ROAD: 150, SLOWS_ROAD: 300, NO_CIVILIAN_ENTRY: 400, AVOID_AREA: 0 };

/** Road restrictions derived from actionable effects only, each at its own member's geometry. */
export function restrictionsFrom(clusters: EventCluster[]): { restrictions: Restriction[]; slowdowns: Slowdown[] } {
  const restrictions: Restriction[] = [];
  const slowdowns: Slowdown[] = [];
  for (const c of clusters) {
    for (const a of c.actionableAreas ?? []) {
      const radiusM = a.radiusM ?? DEFAULT_RADIUS[a.kind] ?? 0;
      if (a.kind === "BLOCKS_ROAD" || a.kind === "AVOID_AREA" || a.kind === "NO_CIVILIAN_ENTRY") {
        restrictions.push({ clusterId: c.id, title: c.title, geometry: a.geometry, radiusM, kind: a.kind });
      } else if (a.kind === "SLOWS_ROAD") {
        slowdowns.push({ clusterId: c.id, title: c.title, geometry: a.geometry, radiusM, delayMinutes: a.delayMinutes ?? 5 });
      }
    }
  }
  return { restrictions, slowdowns };
}
