import { ASSET_LABELS, CREDENTIAL_LABELS, SKILL_LABELS, TRAINING_LABELS } from "@/domain/catalog";
import type {
  CandidateEvaluation,
  GateResult,
  Incident,
  Mission,
  MissionStatus,
  RequirementSlot,
  Responder,
  ScoreComponent,
  SlotMatch,
} from "@/domain/types";
import { distanceKm, round1 } from "./geo";
import { credentialState, readinessLevel } from "./readiness";
import { VULNERABLE_OCCUPANT } from "./rules";

/**
 * Deterministic capability matching.
 *
 * 1. Every candidate is run through ALL hard gates (pass/fail, with reasons).
 * 2. Only candidates that pass every gate receive a score.
 * 3. Proximity is one weighted factor in the score — it is never consulted
 *    until the gates have passed, so it cannot override a missing credential
 *    or a safety restriction (rule R-M01).
 */

/** Statuses in which people and equipment are committed. */
export const ACTIVE_MISSION_STATUSES: MissionStatus[] = ["DISPATCHED", "REROUTING", "IN_PROGRESS", "ON_HOLD"];

/** Distance at which the proximity score reaches zero. */
export const PROXIMITY_SCALE_KM = 40;

/** Score weights (sum = 100). Applied only to candidates that passed every hard gate. */
export const SCORE_WEIGHTS = [
  { key: "proximity", label: "Proximity", max: 35, how: `Linear from 35 at 0 km to 0 at ${40} km.` },
  { key: "availability", label: "Availability", max: 15, how: "15 if available now, 6 if limited." },
  { key: "readiness", label: "Readiness level", max: 10, how: "2.5 per readiness level (0–4)." },
  { key: "experience", label: "Verified experience", max: 10, how: "1 per verified mission, up to 10." },
  { key: "bundling", label: "Brings other needed equipment", max: 10, how: "10 if the responder can also supply another required asset." },
  { key: "fit", label: "Language / accessibility fit", max: 10, how: "6 for speaking the household's language; 4 for mobility-assistance experience when needed." },
  { key: "safety", label: "Extra safety credential", max: 5, how: "5 for verified First Aid/CPR or CERT beyond the role's requirements." },
  { key: "offered", label: "Volunteered for this request", max: 5, how: "5 if the volunteer offered from their dashboard." },
] as const;

export type MatchIncident = Pick<Incident, "id" | "location" | "triage" | "requirements" | "assessment" | "offers" | "missionId">;

export interface MatchContext {
  incident: MatchIncident;
  responders: Responder[];
  missions: Mission[];
  now: Date;
}

export interface Commitments {
  /** responderId → mission code for people deployed on another active mission. */
  personBusy: Map<string, string>;
  /** assetId → units committed to active missions. */
  assetCommitted: Map<string, number>;
}

/**
 * Deployments derived from active missions. A PERSON who only delivers
 * equipment on a mission is still deployed there — they cannot be on two
 * missions at once. Organizations are limited by equipment quantity instead.
 */
export function computeCommitments(missions: Mission[], excludeIncidentId: string | undefined, responders: Pick<Responder, "id" | "kind">[]): Commitments {
  const people = new Set(responders.filter((r) => r.kind === "PERSON").map((r) => r.id));
  const personBusy = new Map<string, string>();
  const assetCommitted = new Map<string, number>();
  for (const m of missions) {
    if (!ACTIVE_MISSION_STATUSES.includes(m.status) || m.incidentId === excludeIncidentId) continue;
    for (const a of m.assignments) {
      if (a.assetId) assetCommitted.set(a.assetId, (assetCommitted.get(a.assetId) ?? 0) + a.quantity);
      if (!a.assetId || people.has(a.responderId)) personBusy.set(a.responderId, m.code);
    }
  }
  return { personBusy, assetCommitted };
}

/** Background-check requirement for anyone delivering equipment on-site to a vulnerable household (R-V01). */
export function providerCredentialsFor(slot: RequirementSlot, incident: MatchIncident) {
  if (slot.kind === "PERSON") return slot.credentials;
  const vulnerable = incident.assessment.vulnerabilities.some((v) => VULNERABLE_OCCUPANT.includes(v));
  if (vulnerable && slot.asset !== "SHELTER_BEDS") return Array.from(new Set([...slot.credentials, "BACKGROUND_CHECK" as const]));
  return slot.credentials;
}

export function isInPool(slot: RequirementSlot, r: Responder): boolean {
  if (slot.kind === "PERSON") return r.kind === "PERSON" && !!slot.skill && r.skills.includes(slot.skill);
  return r.assets.some((a) => a.type === slot.asset);
}

export function evaluateCandidate(
  slot: RequirementSlot,
  r: Responder,
  ctx: MatchContext,
  commitments: Commitments = computeCommitments(ctx.missions, ctx.incident.id, ctx.responders),
): CandidateEvaluation {
  const { incident, now } = ctx;
  const gates: GateResult[] = [];
  const d = distanceKm(incident.location, r.location);

  gates.push({
    gate: "SAFETY",
    passed: incident.triage.civilianDispatchAllowed,
    detail: incident.triage.civilianDispatchAllowed
      ? "Triage permits civilian mission"
      : `Civilian dispatch prohibited (${incident.triage.level.replace(/_/g, " ").toLowerCase()})`,
  });

  gates.push({
    gate: "IDENTITY",
    passed: r.identityVerified,
    detail: r.identityVerified ? (r.kind === "ORGANIZATION" ? "Organization verified" : "Identity verified") : "Identity not yet verified",
  });

  gates.push({
    gate: "AVAILABILITY",
    passed: r.availability.status !== "UNAVAILABLE",
    detail:
      r.availability.status === "UNAVAILABLE"
        ? `Unavailable${r.availability.note ? ` — ${r.availability.note}` : ""}`
        : r.availability.status === "LIMITED"
          ? `Limited availability${r.availability.note ? ` — ${r.availability.note}` : ""}`
          : "Available now",
  });

  let assetId: string | undefined;
  if (slot.kind === "PERSON") {
    const busy = commitments.personBusy.get(r.id);
    gates.push({ gate: "CAPACITY", passed: !busy, detail: busy ? `Deployed on ${busy}` : "Not deployed elsewhere" });
    const hasSkill = !!slot.skill && r.skills.includes(slot.skill);
    gates.push({ gate: "SKILL", passed: hasSkill, detail: `${hasSkill ? "Has" : "Lacks"} skill: ${slot.skill ? SKILL_LABELS[slot.skill] : "—"}` });
  } else {
    const suitable = r.assets.filter((a) => a.type === slot.asset && (!slot.accessibleRequired || a.accessible));
    const withQty = suitable
      .map((a) => ({ a, free: a.quantity - (commitments.assetCommitted.get(a.id) ?? 0) }))
      .sort((x, y) => y.free - x.free);
    const bestTotal = suitable.find((a) => a.quantity >= slot.quantity);
    const label = slot.asset ? ASSET_LABELS[slot.asset] : "asset";
    gates.push({
      gate: "ASSET",
      passed: !!bestTotal,
      detail: bestTotal
        ? `Has ${label}${slot.accessibleRequired ? " (accessible)" : ""}${slot.quantity > 1 ? ` — ${bestTotal.quantity} on hand, ${slot.quantity} needed` : ""}`
        : suitable.length
          ? `Insufficient ${label}: ${suitable[0].quantity} on hand, ${slot.quantity} needed`
          : `No ${slot.accessibleRequired ? "accessible " : ""}${label}`,
    });
    const free = withQty.find((x) => x.free >= slot.quantity);
    const personBusy = r.kind === "PERSON" ? commitments.personBusy.get(r.id) : undefined;
    const capacityOk = !!free && !personBusy;
    assetId = (free ?? withQty[0])?.a.id;
    gates.push({
      gate: "CAPACITY",
      passed: capacityOk,
      detail: personBusy
        ? `Owner deployed on ${personBusy}`
        : free
          ? `${free.free} available now`
          : withQty.length
            ? `Committed to active missions (${Math.max(0, withQty[0].free)} free)`
            : "None available",
    });
  }

  const creds = providerCredentialsFor(slot, incident);
  if (creds.length) {
    const failures: string[] = [];
    const passes: string[] = [];
    for (const c of creds) {
      const st = credentialState(r, c, now);
      (st.valid ? passes : failures).push(`${CREDENTIAL_LABELS[c]}: ${st.reason}`);
    }
    gates.push({
      gate: "CREDENTIALS",
      passed: failures.length === 0,
      detail: failures.length ? failures.join("; ") : passes.join("; "),
    });
  }

  if (slot.training.length) {
    const missing = slot.training.filter((m) => !r.training.some((t) => t.moduleId === m));
    gates.push({
      gate: "TRAINING",
      passed: missing.length === 0,
      detail: missing.length
        ? `Missing: ${missing.map((m) => TRAINING_LABELS[m].title).join(", ")}`
        : `Completed: ${slot.training.map((m) => TRAINING_LABELS[m].title).join(", ")}`,
    });
  }

  gates.push({
    gate: "RANGE",
    passed: d <= r.maxTravelKm,
    detail: `${round1(d)} km away — travel radius ${r.maxTravelKm} km`,
  });

  const eligible = gates.every((g) => g.passed);
  const offered = incident.offers.includes(r.id);
  const scoreBreakdown = eligible ? scoreCandidate(slot, r, ctx, d, offered, commitments) : [];
  const score = Math.round(scoreBreakdown.reduce((s, c) => s + c.points, 0));

  return {
    responderId: r.id,
    name: r.name,
    kind: r.kind,
    role: r.role,
    distanceKm: round1(d),
    eligible,
    gates,
    score,
    scoreBreakdown,
    assetId,
    offered,
  };
}

function scoreCandidate(
  slot: RequirementSlot,
  r: Responder,
  ctx: MatchContext,
  d: number,
  offered: boolean,
  commitments: Commitments,
): ScoreComponent[] {
  const { incident, now } = ctx;
  const proximity = 35 * Math.max(0, 1 - d / PROXIMITY_SCALE_KM);
  const availability = r.availability.status === "AVAILABLE" ? 15 : 6;
  const readiness = readinessLevel(r, now).level * 2.5;
  const experience = Math.min(r.stats.missionsCompleted, 10);

  // Bundling: can this responder also supply other equipment this incident needs?
  const otherAssetSlots = incident.requirements.filter((s) => s.kind === "ASSET" && s.id !== slot.id);
  const bundles = otherAssetSlots.filter((s) =>
    r.assets.some((a) => a.type === s.asset && a.quantity - (commitments.assetCommitted.get(a.id) ?? 0) >= s.quantity),
  ).length;
  const bundling = bundles > 0 ? 10 : 0;

  let fit = 0;
  const lang = incident.assessment.language;
  if (lang !== "en" && r.languages.includes(lang)) fit += 6;
  if (
    incident.assessment.vulnerabilities.includes("MOBILITY_LIMITED") &&
    r.accessibilitySupport.some((s) => s === "MOBILITY_ASSIST" || s === "WHEELCHAIR_TRANSPORT")
  )
    fit += 4;

  const extraSafety =
    (["FIRST_AID_CPR", "CERT_BASIC"] as const).some((c) => !slot.credentials.includes(c) && credentialState(r, c, now).valid) ? 5 : 0;

  const points = [round1(proximity), availability, readiness, experience, bundling, fit, extraSafety, offered ? 5 : 0];
  return SCORE_WEIGHTS.map((w, i) => ({ label: w.label, points: points[i], max: w.max }));
}

export function compareCandidates(a: CandidateEvaluation, b: CandidateEvaluation): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.eligible) {
    if (b.score !== a.score) return b.score - a.score;
  }
  if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
  return a.responderId.localeCompare(b.responderId);
}

export function matchSlot(slot: RequirementSlot, ctx: MatchContext, commitments?: Commitments): SlotMatch {
  const c = commitments ?? computeCommitments(ctx.missions, ctx.incident.id, ctx.responders);
  const candidates = ctx.responders
    .filter((r) => isInPool(slot, r))
    .map((r) => evaluateCandidate(slot, r, ctx, c))
    .sort(compareCandidates);
  return { slotId: slot.id, eligibleCount: candidates.filter((x) => x.eligible).length, candidates };
}

export function matchIncident(ctx: MatchContext): SlotMatch[] {
  const c = computeCommitments(ctx.missions, ctx.incident.id, ctx.responders);
  return ctx.incident.requirements.map((s) => matchSlot(s, ctx, c));
}

/** The nearest candidate in the pool who was rejected while someone farther was ranked first. */
export function nearestRejected(match: SlotMatch): { rejected: CandidateEvaluation; selected: CandidateEvaluation } | undefined {
  const top = match.candidates.find((c) => c.eligible);
  if (!top) return undefined;
  const rejected = match.candidates
    .filter((c) => !c.eligible && c.distanceKm < top.distanceKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  return rejected ? { rejected, selected: top } : undefined;
}

export function failedGates(c: CandidateEvaluation): GateResult[] {
  return c.gates.filter((g) => !g.passed);
}
