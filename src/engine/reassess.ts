import type { EventCluster, EvidenceItem, MissionHold, Position, ReassessmentOutcome, RoutePlan } from "@/domain/ops";
import type { DispatchCheck, Incident, Mission, MissionStatus, NeedType } from "@/domain/types";
import { clock } from "@/lib/format";
import { pathAffected, pointAffected, toPosition } from "./geometry";
import type { Restriction } from "./routing";
import { routeConflicts } from "./routing";

/**
 * Continuous mission reassessment — a deterministic policy table.
 *
 * Mission safety is not established once at dispatch. Every time the
 * operational picture changes, each active mission is re-evaluated against
 * ACTIONABLE conditions only (see correlate.ts). The LLM never chooses these
 * outcomes.
 *
 * Precedence: ESCALATE > HOLD > REROUTE > CONTINUE.
 */

export interface PolicyRule {
  id: string;
  title: string;
  outcome: ReassessmentOutcome;
  description: string;
}

export const REASSESSMENT_RULES: PolicyRule[] = [
  { id: "W-01", title: "Tornado warning at mission site or on route", outcome: "HOLD", description: "Any mission whose site or remaining route intersects an active tornado-warning area is held. Teams on scene take shelter; mobilizing teams do not travel." },
  { id: "W-02", title: "Severe weather over outdoor work", outcome: "HOLD", description: "Severe thunderstorm or high-wind warnings hold outdoor work (saws, ladders, roofs, debris) at sites inside the warning area." },
  { id: "S-01", title: "No-civilian-entry condition at site", outcome: "ESCALATE", description: "Fire, hazmat or evacuation areas covering the mission site suspend the civilian mission and require professional follow-up." },
  { id: "R-01", title: "Known restriction on the planned route", outcome: "REROUTE", description: "If an actionable closure or avoid-area intersects the remaining route, a new route is planned within the usable network." },
  { id: "R-02", title: "No usable route", outcome: "HOLD", description: "If every route to the site is blocked by known conditions, the mission is held — never routed through a restriction." },
  { id: "H-01", title: "Hold condition cleared", outcome: "CONTINUE", description: "When the condition behind a hold expires or is withdrawn, the hold is marked cleared. A coordinator resumes the mission; it never resumes silently." },
];

const OUTDOOR_NEEDS: NeedType[] = ["TREE_CUTTING", "DEBRIS_REMOVAL", "ACCESS_BLOCKED", "ROOF_TARP"];

export function missionExposure(incident: Pick<Incident, "assessment">): "OUTDOOR" | "INDOOR" {
  return incident.assessment.needs.some((n) => OUTDOOR_NEEDS.includes(n)) ? "OUTDOOR" : "INDOOR";
}

/** Missions whose teams/resources are committed and therefore watched. */
export const WATCHED_STATUSES: MissionStatus[] = ["DISPATCHED", "REROUTING", "IN_PROGRESS", "ON_HOLD"];
/** Statuses in which the team is travelling, so the route matters. */
export const MOVING_STATUSES: MissionStatus[] = ["DISPATCHED", "REROUTING"];

export interface RuleHit {
  ruleId: string;
  outcome: ReassessmentOutcome;
  clusters: EventCluster[];
  reason: string;
  instruction: string;
}

export interface Assessment {
  outcome: ReassessmentOutcome;
  hits: RuleHit[];
  /** A new route must be computed (outcome REROUTE); the caller plans it and falls back to R-02 if none exists. */
  needsRoute: boolean;
  /** Any HOLD or ESCALATE condition currently applies to this mission. */
  holding: boolean;
  /** For ON_HOLD missions: no hold/escalate condition applies any more (a route may still be needed — see lifecycle). */
  holdCleared: boolean;
  evidence: EvidenceItem[];
}

/**
 * A closure that covers the job site itself is the job (e.g. the tree the crew
 * is going to clear): it must not make the site unreachable. Only road
 * blockages are exempt — no-civilian-entry areas are handled by S-01.
 */
export function restrictionsForSite(restrictions: Restriction[], site: Position): Restriction[] {
  return restrictions.filter((r) => !(r.kind === "BLOCKS_ROAD" && pointAffected(site, r.geometry, r.radiusM)));
}

const fmtTime = (iso?: string) => (iso ? clock(iso) : undefined);

/** Evaluate one mission against the current actionable operational picture. Pure. */
export function assessMission(args: {
  mission: Mission;
  incident: Incident;
  clusters: EventCluster[];
  restrictions: Restriction[];
}): Assessment {
  const { mission, incident, clusters, restrictions } = args;
  const site: Position = toPosition(incident.location);
  const moving = MOVING_STATUSES.includes(mission.status) || (mission.status === "ON_HOLD" && !!mission.heldFrom && MOVING_STATUSES.includes(mission.heldFrom));
  const onScene = mission.status === "IN_PROGRESS" || (mission.status === "ON_HOLD" && mission.heldFrom === "IN_PROGRESS");
  const path = mission.route?.path ?? [];
  const exposure = missionExposure(incident);
  const hits: RuleHit[] = [];

  // Each actionable effect is tested at the geometry of the member that proposed it.
  const withEffect = (kind: string) =>
    clusters
      .map((c) => ({ c, areas: (c.actionableAreas ?? []).filter((a) => a.kind === kind) }))
      .filter((x) => x.areas.length);

  // W-01 tornado (HOLD_ALL_ACTIVITY)
  for (const { c, areas } of withEffect("HOLD_ALL_ACTIVITY")) {
    const atSite = areas.some((a) => pointAffected(site, a.geometry, a.radiusM ?? 0));
    const onRoute = moving && path.length > 1 && areas.some((a) => pathAffected(path, a.geometry, a.radiusM ?? 0));
    if (atSite || onRoute) {
      const until = fmtTime(c.expiresAt);
      hits.push({
        ruleId: "W-01",
        outcome: "HOLD",
        clusters: [c],
        reason: `${c.title} ${atSite ? "covers the mission area" : "intersects the team's route"}${until ? ` (in effect until ${until})` : ""}.`,
        instruction: onScene ? "Stop work now and take shelter in the sturdiest nearby building. Do not travel." : "Do not travel. Shelter where you are until the warning ends and the coordinator resumes the mission.",
      });
    }
  }

  // W-02 severe thunderstorm / high wind over outdoor work
  if (exposure === "OUTDOOR") {
    for (const { c, areas } of withEffect("HOLD_OUTDOOR_WORK")) {
      if (areas.some((a) => pointAffected(site, a.geometry, a.radiusM ?? 0))) {
        const until = fmtTime(c.expiresAt);
        hits.push({
          ruleId: "W-02",
          outcome: "HOLD",
          clusters: [c],
          reason: `${c.title} covers this outdoor work site${until ? ` (until ${until})` : ""}.`,
          instruction: "Stop saw, ladder and roof work. Move into a building or vehicle away from trees until the coordinator resumes.",
        });
      }
    }
  }

  // S-01 no civilian entry at site
  for (const r of restrictions.filter((x) => x.kind === "NO_CIVILIAN_ENTRY")) {
    if (pointAffected(site, r.geometry, r.radiusM)) {
      hits.push({
        ruleId: "S-01",
        outcome: "ESCALATE",
        clusters: clusters.filter((c) => c.id === r.clusterId),
        reason: `${r.title} affects the mission site — civilians must not enter.`,
        instruction: "Leave the area. The civilian mission is suspended and professional follow-up is recommended.",
      });
    }
  }

  // R-01 restriction on the remaining route (a blockage at the site itself is the job, not an obstacle)
  let needsRoute = false;
  if (moving && path.length > 1) {
    const conflicts = routeConflicts(path, restrictionsForSite(restrictions, site));
    if (conflicts.length) {
      needsRoute = true;
      hits.push({
        ruleId: "R-01",
        outcome: "REROUTE",
        clusters: clusters.filter((c) => conflicts.some((r) => r.clusterId === c.id)),
        reason: `${Array.from(new Set(conflicts.map((r) => r.title))).join("; ")} now affects the previous route.`,
        instruction: "Follow the updated route.",
      });
    }
  }

  const rank: Record<ReassessmentOutcome, number> = { ESCALATE: 4, HOLD: 3, RETURN_TO_SAFE_LOCATION: 3, REROUTE: 2, CONTINUE: 1 };
  const outcome = hits.reduce<ReassessmentOutcome>((o, h) => (rank[h.outcome] > rank[o] ? h.outcome : o), "CONTINUE");

  // H-01 is decided in lifecycle.applyAssessment, which also knows whether a new route exists.
  const holding = hits.some((h) => h.outcome === "HOLD" || h.outcome === "ESCALATE");
  const holdCleared = mission.status === "ON_HOLD" && !holding;

  const evidence = hits.flatMap((h) => h.clusters.flatMap((c) => c.evidence));
  return { outcome, hits, needsRoute: needsRoute && outcome === "REROUTE", holding, holdCleared, evidence };
}

export function holdFrom(hit: RuleHit, now: Date): MissionHold {
  return {
    ruleId: hit.ruleId,
    reason: hit.reason,
    since: now.toISOString(),
    clusterIds: hit.clusters.map((c) => c.id),
    evidence: hit.clusters.flatMap((c) => c.evidence),
    expiresAt: hit.clusters.map((c) => c.expiresAt).filter(Boolean).sort().at(-1),
    instruction: hit.instruction,
  };
}

/** One-line human explanation of a route change. */
export function describeReroute(prev: RoutePlan | undefined, next: RoutePlan, reason: string): string {
  const eta = prev ? `ETA ${prev.etaMinutes} → ${next.etaMinutes} min` : `ETA ${next.etaMinutes} min`;
  return `Route updated: ${reason} New route via ${next.roads.join(", ") || "local roads"}; ${eta}.`;
}

/**
 * Operational-picture checks added to the dispatch gate (rule R-D01):
 *  D-ROUTE      a route to the site exists within the usable network
 *  D-CONDITIONS no actionable hold/escalate condition covers the site or route
 */
export function dispatchOpsChecks(args: {
  incident: Incident;
  mission: Mission;
  clusters: EventCluster[];
  restrictions: Restriction[];
  route: RoutePlan | null;
  /** Live mode: required sources that have not delivered data yet. Missing data is never treated as "clear". */
  missingSources?: string[];
}): DispatchCheck[] {
  const { route } = args;
  const estimate = route?.provider === "straight-line-estimate";
  const checks: DispatchCheck[] = [
    {
      id: "D-ROUTE",
      label: estimate ? "Route check (estimate only — no road routing here)" : "Route avoids known closures",
      passed: !!route,
      detail: route
        ? estimate
          ? `The straight line (${route.distanceKm} km, ~${route.etaMinutes} min) crosses no known restriction, but actual roads were not checked — confirm the route with the team.`
          : `${route.distanceKm} km, ETA ${route.etaMinutes} min${route.avoided.length ? `, avoiding ${Array.from(new Set(route.avoided.map((a) => a.title))).join("; ")}` : ""}`
        : "No route to the site avoids the known restrictions (rule R-02)",
    },
  ];
  if (args.missingSources) {
    checks.push({
      id: "D-SOURCES",
      label: "Live condition sources reporting",
      passed: args.missingSources.length === 0,
      detail: args.missingSources.length ? `No current data from: ${args.missingSources.join(", ")}. Missing data is not treated as clear.` : "Every configured source has delivered current data",
    });
  }
  const hypothetical: Mission = { ...args.mission, status: "DISPATCHED", route: route ?? undefined };
  const a = assessMission({ mission: hypothetical, incident: args.incident, clusters: args.clusters, restrictions: args.restrictions });
  const blocking = a.hits.filter((h) => h.outcome === "HOLD" || h.outcome === "ESCALATE");
  const actionable = args.clusters.filter((c) => c.actionableEffects.length).length;
  checks.push({
    id: "D-CONDITIONS",
    label: "No active weather or safety hold at the site",
    passed: blocking.length === 0,
    detail: blocking.length ? blocking.map((h) => `${h.ruleId}: ${h.reason}`).join(" | ") : `${actionable} actionable condition(s) checked`,
  });
  return checks;
}
