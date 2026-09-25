import type { DispatchCheck, Incident, Mission, Responder } from "@/domain/types";
import { computeCommitments, evaluateCandidate, failedGates } from "./matching";
import { assessIncident } from "./requirements";
import { slotIsOptional } from "@/domain/slots";

/**
 * Dispatch gate (rule R-D01). Re-validates everything at the moment of
 * dispatch: triage is recomputed from the validated assessment, and every
 * assignment is re-run through the hard gates against *current* credentials,
 * availability and deployments. Any failure blocks dispatch, except missing optional
 * roles/equipment, which a coordinator may explicitly accept (allowPartial).
 */
export function checkDispatch(input: {
  incident: Incident;
  mission: Mission;
  responders: Responder[];
  missions: Mission[];
  now: Date;
  /** Coordinator acknowledged dispatching without the unfilled optional roles/equipment. */
  allowPartial?: boolean;
}): { ok: boolean; checks: DispatchCheck[] } {
  const { incident, mission, responders, missions, now } = input;
  const checks: DispatchCheck[] = [];

  const re = assessIncident({
    assessment: incident.assessment,
    immediateDangerReported: incident.request.immediateDanger,
    clearances: incident.hazardClearances,
    now,
  });
  checks.push({
    id: "D-TRIAGE",
    label: "Safety triage re-run",
    passed: re.triage.civilianDispatchAllowed,
    detail: re.triage.civilianDispatchAllowed
      ? `Still ${re.triage.level.replace(/_/g, " ").toLowerCase()}`
      : "Hazard present — civilian dispatch prohibited",
  });

  const pending = incident.advisories.filter((a) => a.requiresAcknowledgement && !a.acknowledgedAt);
  checks.push({
    id: "D-ADVISORY",
    label: "Safety advisories acknowledged",
    passed: pending.length === 0,
    detail: pending.length ? `${pending.length} advisory(ies) need coordinator acknowledgement` : incident.advisories.length ? "All acknowledged" : "None raised",
  });

  const assignedSlots = new Set(mission.assignments.map((a) => a.slotId));
  const missing = incident.requirements.filter((s) => !assignedSlots.has(s.id));
  const essential = missing.filter((s) => !slotIsOptional(s));
  const optional = missing.filter((s) => slotIsOptional(s));
  const anyAssigned = mission.assignments.length > 0;
  const filled = incident.requirements.length - missing.length;
  const list = (xs: typeof missing) => xs.map((s) => s.label).join(", ");
  let slots: DispatchCheck;
  if (incident.requirements.length === 0) {
    slots = { id: "D-SLOTS", label: "Every required role filled", passed: false, detail: "No capability requirements defined — a coordinator must classify the need first" };
  } else if (essential.length || !anyAssigned) {
    slots = {
      id: "D-SLOTS",
      label: "Every essential role filled",
      passed: false,
      detail: `Unfilled essential: ${list(essential) || "nobody assigned"}${optional.length ? ` (optional also missing: ${list(optional)})` : ""}. Essential roles cannot be skipped.`,
    };
  } else if (optional.length) {
    slots = {
      id: "D-SLOTS",
      label: "Every essential role filled",
      passed: !!input.allowPartial,
      acknowledgeable: !input.allowPartial,
      detail: input.allowPartial
        ? `${filled} of ${incident.requirements.length} filled — coordinator chose to dispatch without: ${list(optional)}`
        : `All essential roles filled. Missing optional: ${list(optional)} — the coordinator can dispatch without it.`,
    };
  } else {
    slots = { id: "D-SLOTS", label: "Every required role filled", passed: true, detail: `${filled} of ${incident.requirements.length} roles filled` };
  }
  checks.push(slots);

  const byId = new Map(responders.map((r) => [r.id, r]));
  const commitments = computeCommitments(missions, incident.id, responders);
  const ctx = { incident, responders, missions, now };
  const gateFailures: string[] = [];
  for (const a of mission.assignments) {
    const slot = incident.requirements.find((s) => s.id === a.slotId);
    const r = byId.get(a.responderId);
    if (!slot || !r) {
      gateFailures.push(`${a.responderId}: no longer exists`);
      continue;
    }
    const ev = evaluateCandidate(slot, r, ctx, commitments);
    if (!ev.eligible) gateFailures.push(`${r.name} (${slot.label}): ${failedGates(ev).map((g) => g.detail).join("; ")}`);
  }
  checks.push({
    id: "D-GATES",
    label: "Assignments re-checked (credentials, availability, range)",
    passed: gateFailures.length === 0,
    detail: gateFailures.length ? gateFailures.join(" | ") : `${mission.assignments.length} assignments pass every gate`,
  });

  const people = mission.assignments.filter((a) => !a.assetId).map((a) => a.responderId);
  const dup = people.filter((p, i) => people.indexOf(p) !== i);
  checks.push({
    id: "D-UNIQUE",
    label: "No person double-assigned",
    passed: dup.length === 0,
    detail: dup.length ? `Duplicate: ${dup.join(", ")}` : "Each person holds one role",
  });

  return { ok: checks.every((c) => c.passed), checks };
}
