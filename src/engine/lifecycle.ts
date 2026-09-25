import { ESCALATION_LABELS, HAZARD_LABELS, NEED_LABELS } from "@/domain/catalog";
import type { DecisionRecord, RoutePlan } from "@/domain/ops";
import type { DispatchCheck, EscalationTarget, Hazard, Incident, Mission, NeedType, Responder, TimelineEvent } from "@/domain/types";
import { slotIsOptional } from "@/domain/slots";
import { checkDispatch } from "./dispatch";
import { recommendedHandoff } from "./handoff";
import { hasRequestedHelp, markHandedOff, NavigatorError, requestHelp, resolveNeed, syncNeedsWithMission } from "./navigator";
import { requirementsForNeeds, retriage } from "./pipeline";
import { assessMission, describeReroute, holdFrom } from "./reassess";
import { assembleTeam } from "./team";
import { buildAdvisories } from "./triage";
import { needCategory } from "./validate";
import { missionTitle } from "./titles";

/**
 * Pure mission lifecycle transitions. Services load state, call these, and
 * persist the results. Every transition appends to the incident timeline.
 *
 *   PROPOSED → DISPATCHED → IN_PROGRESS → COMPLETED → VERIFIED
 *                  ↕ REROUTING      ↕ ON_HOLD (rules hold; a coordinator resumes)
 */

export class LifecycleError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const log = (incident: Incident, e: TimelineEvent): Incident => ({ ...incident, updatedAt: e.at, timeline: [...incident.timeline, e] });

export function missionCode(n: number) {
  return `MSN-${String(n).padStart(3, "0")}`;
}

export function proposeTeam(args: {
  incident: Incident;
  existing?: Mission;
  responders: Responder[];
  missions: Mission[];
  missionNumber: number;
  overrides?: Record<string, string>;
  actor: string;
  now: Date;
}): { incident: Incident; mission: Mission; rejectedOverrides: { slotId: string; responderId: string; reason: string }[] } {
  const { incident, now } = args;
  if (!incident.triage.civilianDispatchAllowed) throw new LifecycleError("Civilian team cannot be formed: incident is escalated to professional responders.");
  if (incident.requirements.length === 0) throw new LifecycleError("No capability requirements were identified. Adjust the incident's needs before forming a team.", 422);
  if (!hasRequestedHelp(incident.needs)) {
    throw new LifecycleError("Nobody has asked for coordinated community help yet (rule N-15). Request it for specific needs — on the resident's behalf if they asked by phone — before forming a team.");
  }
  if (args.existing && !["PROPOSED", "CANCELLED"].includes(args.existing.status)) {
    throw new LifecycleError(`Mission ${args.existing.code} is already ${args.existing.status.toLowerCase()}.`);
  }
  const team = assembleTeam({ incident, responders: args.responders, missions: args.missions, now }, args.overrides ?? {});
  const at = now.toISOString();
  const number = args.existing?.status === "PROPOSED" ? args.existing.number : args.missionNumber;
  const mission: Mission = {
    id: args.existing?.status === "PROPOSED" ? args.existing.id : `msn-${number}-${incident.id}`,
    workspaceId: incident.workspaceId,
    number,
    code: missionCode(number),
    title: missionTitle(incident.assessment),
    incidentId: incident.id,
    status: "PROPOSED",
    assignments: team.assignments,
    unfilledSlotIds: team.unfilledSlotIds,
    createdAt: args.existing?.createdAt ?? at,
  };
  const byId = new Map(args.responders.map((r) => [r.id, r.name]));
  const names = Array.from(new Set(team.assignments.map((a) => byId.get(a.responderId)))).join(", ");
  const updated = log(
    { ...incident, status: "TEAM_FORMING", missionId: mission.id, needs: syncNeedsWithMission(incident.needs, mission, now) },
    {
      at,
      actor: args.actor === "engine" ? "rules" : "coordinator",
      message: `${mission.code} “${mission.title}” proposed: ${names || "no eligible resources"}${team.unfilledSlotIds.length ? ` — ${team.unfilledSlotIds.length} role(s) unfilled` : ""}.`,
    },
  );
  return { incident: updated, mission, rejectedOverrides: team.rejectedOverrides };
}

export function dispatch(args: {
  incident: Incident;
  mission: Mission;
  responders: Responder[];
  missions: Mission[];
  actorName: string;
  /** Operational-picture checks (route exists, no hold condition at site) from the caller. */
  extraChecks?: DispatchCheck[];
  /** Coordinator explicitly accepts dispatching without unfilled optional roles/equipment. */
  allowPartial?: boolean;
  note?: string;
  now: Date;
}): { incident: Incident; mission: Mission } {
  const { incident, mission, now } = args;
  if (mission.status !== "PROPOSED") throw new LifecycleError(`${mission.code} is ${mission.status.toLowerCase()}, not awaiting dispatch.`);
  const base = checkDispatch({ incident, mission, responders: args.responders, missions: args.missions, now, allowPartial: args.allowPartial });
  const checks = [...base.checks, ...(args.extraChecks ?? [])];
  const result = { ok: checks.every((c) => c.passed), checks };
  const at = now.toISOString();
  if (!result.ok) {
    throw new LifecycleError("Dispatch blocked by validation gate.", 422, { checks: result.checks });
  }
  const assigned = new Set(mission.assignments.map((a) => a.slotId));
  const without = incident.requirements.filter((s) => slotIsOptional(s) && !assigned.has(s.id));
  const note = args.note?.trim() || undefined;
  const dispatchedWithout = without.length ? { slotIds: without.map((s) => s.id), labels: without.map((s) => s.label), note, by: args.actorName } : undefined;
  return {
    mission: { ...mission, status: "DISPATCHED", dispatchedAt: at, dispatchChecks: result.checks, ...(dispatchedWithout ? { dispatchedWithout } : {}) },
    incident: log(
      { ...incident, status: "ACTIVE" },
      {
        at,
        actor: "coordinator",
        message: `${args.actorName} dispatched ${mission.code} after ${result.checks.length} validation checks passed${
          dispatchedWithout ? `, accepting it goes without: ${dispatchedWithout.labels.join(", ")}${note ? ` (“${note}”)` : ""}` : ""
        }. Team notification simulated (no SMS/push provider in this prototype).`,
      },
    ),
  };
}

export function startMission(incident: Incident, mission: Mission, actorName: string, now: Date) {
  if (mission.status === "ON_HOLD") throw new LifecycleError(`${mission.code} is on hold: ${mission.hold?.reason ?? "safety hold"}`);
  if (mission.status !== "DISPATCHED" && mission.status !== "REROUTING") throw new LifecycleError(`${mission.code} must be dispatched before it can start.`);
  const at = now.toISOString();
  return {
    mission: { ...mission, status: "IN_PROGRESS" as const, startedAt: at },
    incident: log(incident, { at, actor: "volunteer", message: `${actorName} checked in on scene.` }),
  };
}

export function completeMission(incident: Incident, mission: Mission, actorName: string, note: string, now: Date) {
  if (mission.status === "ON_HOLD") throw new LifecycleError(`${mission.code} is on hold and cannot be completed until resumed.`);
  if (!["DISPATCHED", "REROUTING", "IN_PROGRESS"].includes(mission.status)) throw new LifecycleError(`${mission.code} is not active.`);
  const at = now.toISOString();
  return {
    mission: { ...mission, status: "COMPLETED" as const, completedAt: at, startedAt: mission.startedAt ?? at, completionNote: note },
    incident: log(incident, { at, actor: "volunteer", message: `${actorName} marked ${mission.code} complete: “${note}”. Team released; awaiting verification.` }),
  };
}

/**
 * Verification by coordinator or the resident closes the incident, credits
 * volunteer hours and draws down consumable supplies.
 */
export function verifyMission(args: {
  incident: Incident;
  mission: Mission;
  responders: Responder[];
  by: string;
  byRole: "coordinator" | "resident";
  note: string;
  now: Date;
}): { incident: Incident; mission: Mission; responders: Responder[] } {
  const { incident, mission, now } = args;
  if (mission.status !== "COMPLETED") throw new LifecycleError(`${mission.code} must be marked complete by the team first.`);
  const at = now.toISOString();
  const hours = Math.max(1, Math.round(((new Date(mission.completedAt!).getTime() - new Date(mission.dispatchedAt ?? mission.createdAt).getTime()) / 36e5) * 10) / 10);
  const touched = new Map<string, Responder>();
  const credited = new Set<string>();
  for (const a of mission.assignments) {
    const r = touched.get(a.responderId) ?? structuredClone(args.responders.find((x) => x.id === a.responderId));
    if (!r) continue;
    if (a.assetId) {
      const asset = r.assets.find((x) => x.id === a.assetId);
      if (asset?.consumable) asset.quantity = Math.max(0, asset.quantity - a.quantity);
    }
    if (!credited.has(r.id)) {
      credited.add(r.id);
      r.stats.missionsCompleted += 1;
      if (r.kind === "PERSON") r.stats.hoursContributed = Math.round((r.stats.hoursContributed + hours) * 10) / 10;
    }
    touched.set(r.id, r);
  }
  return {
    mission: { ...mission, status: "VERIFIED", verifiedAt: at, verification: { by: args.by, note: args.note } },
    incident: log(
      { ...incident, status: "RESOLVED", needs: syncNeedsWithMission(incident.needs, { id: mission.id, status: "VERIFIED" }, now) },
      { at, actor: args.byRole === "resident" ? "resident" : "coordinator", message: `${args.by} verified completion${args.note ? `: “${args.note}”` : ""}. Incident resolved.` },
    ),
    responders: Array.from(touched.values()),
  };
}

export function cancelMission(incident: Incident, mission: Mission, actorName: string, reason: string, now: Date) {
  if (["VERIFIED", "CANCELLED"].includes(mission.status)) throw new LifecycleError(`${mission.code} is already closed.`);
  const at = now.toISOString();
  return {
    mission: { ...mission, status: "CANCELLED" as const },
    incident: log({ ...incident, status: incident.triage.civilianDispatchAllowed ? "OPEN" : "ESCALATED", missionId: undefined, needs: syncNeedsWithMission(incident.needs, undefined, now) }, {
      at,
      actor: "coordinator",
      message: `${actorName} cancelled ${mission.code}${reason ? `: ${reason}` : ""}. Resources released.`,
    }),
  };
}

export function acknowledgeAdvisory(incident: Incident, advisoryId: string, actorName: string, now: Date): Incident {
  const adv = incident.advisories.find((a) => a.id === advisoryId);
  if (!adv) throw new LifecycleError("Advisory not found.", 404);
  if (adv.acknowledgedAt) return incident;
  const at = now.toISOString();
  return log(
    { ...incident, advisories: incident.advisories.map((a) => (a.id === advisoryId ? { ...a, acknowledgedAt: at, acknowledgedBy: actorName } : a)) },
    { at, actor: "coordinator", message: `${actorName} acknowledged advisory (${adv.ruleId}): ${adv.message.split(".")[0]}.` },
  );
}

/**
 * CoORDINATE cannot contact 911, CAD or utilities. A coordinator makes the
 * call through normal channels, then records it here so the timeline is honest
 * about who did what.
 */
export function recordHandoffContact(incident: Incident, target: EscalationTarget, actorName: string, note: string, now: Date): Incident {
  const h = incident.handoffs.find((x) => x.target === target);
  if (!h) throw new LifecycleError("No escalation recommended for that agency.", 404);
  if (h.status !== "RECOMMENDED") return incident;
  const at = now.toISOString();
  return log(
    {
      ...incident,
      handoffs: incident.handoffs.map((x) => (x.target === target ? { ...x, status: "CONTACT_RECORDED" as const, contactedAt: at, contactedBy: actorName, note: note || undefined } : x)),
      needs: markHandedOff(incident.needs, h.needIds, now),
    },
    { at, actor: "coordinator", message: `${actorName} recorded contacting ${ESCALATION_LABELS[target]} (outside CoORDINATE)${note ? `: ${note}` : ""}.` },
  );
}

export function recordHandoffAcknowledgement(incident: Incident, target: EscalationTarget, actorName: string, reference: string, now: Date): Incident {
  const h = incident.handoffs.find((x) => x.target === target);
  if (!h) throw new LifecycleError("No escalation recommended for that agency.", 404);
  if (h.status === "ACKNOWLEDGED") return incident;
  if (h.status === "RECOMMENDED") throw new LifecycleError("Record the contact before recording an acknowledgement.");
  const at = now.toISOString();
  return log(
    { ...incident, handoffs: incident.handoffs.map((x) => (x.target === target ? { ...x, status: "ACKNOWLEDGED" as const, acknowledgedAt: at, reference: reference || undefined } : x)) },
    { at, actor: "coordinator", message: `${actorName} recorded that ${ESCALATION_LABELS[target]} acknowledged${reference ? ` (their reference ${reference})` : ""}.` },
  );
}

/**
 * A coordinator corrects the needs (e.g. the AI misread the request). Hazards
 * are untouched — they can only be cleared by an authority (R-C01). Requirements,
 * triage tier and priority are re-derived deterministically.
 */
export function setNeeds(incident: Incident, needs: NeedType[], actorName: string, now: Date): Incident {
  if (incident.missionId && !["OPEN", "TEAM_FORMING", "ESCALATED", "LOGGED", "GUIDED"].includes(incident.status)) {
    throw new LifecycleError("Needs can only be changed before a team is dispatched.");
  }
  const before = new Set(incident.assessment.needs);
  const after = new Set(needs);
  const added = needs.filter((n) => !before.has(n));
  const removed = incident.assessment.needs.filter((n) => !after.has(n));
  if (!added.length && !removed.length) return incident;
  const at = now.toISOString();
  // Adding needs to an information-only report converts it into a request.
  const converting = !!incident.assessment.informationOnly && needs.length > 0;
  const assessment = {
    ...incident.assessment,
    needs: [...after],
    informationOnly: converting ? false : incident.assessment.informationOnly,
    category: converting && incident.assessment.category === "ROAD_CONDITION_REPORT" ? needCategory(needs[0]) : incident.assessment.category,
  };
  // Re-derive advisories (e.g. adding power for a medical device raises R-A02), keeping prior acknowledgements.
  const previous = new Map(incident.advisories.map((a) => [a.id, a]));
  const rebuilt = buildAdvisories(assessment, incident.hazardMentions).map((a) => previous.get(a.id) ?? a);
  const carried = incident.advisories.filter((a) => a.ruleId === "R-A03" || a.ruleId === "R-A04");
  let re = retriage({ ...incident, assessment, advisories: [...rebuilt, ...carried] }, now);
  // The coordinator is correcting what the resident asked for: if they had asked for help (or the report
  // is being converted into a request), the added community needs are part of that request.
  if (hasRequestedHelp(incident.needs) || converting) {
    const add = re.needs.filter((n) => added.includes(n.type) && (n.status === "HELP_AVAILABLE" || n.status === "NOT_REQUESTED")).map((n) => n.id);
    if (add.length) {
      const needsReq = re.needs.map((n) => (add.includes(n.id) ? { ...n, status: "HELP_REQUESTED" as const, updatedAt: at } : n));
      re = { ...re, needs: needsReq };
      re = { ...re, ...requirementsForNeeds(re, now), status: ["GUIDED", "OPEN"].includes(re.status) ? "OPEN" : re.status };
    }
  }
  return log(re, {
    at,
    actor: "coordinator",
    message: `${actorName} ${converting ? "converted the report into a request and set needs" : "adjusted needs"}${added.length ? ` +${added.map((n) => NEED_LABELS[n]).join(", +")}` : ""}${removed.length ? ` −${removed.map((n) => NEED_LABELS[n]).join(", −")}` : ""}. Requirements re-derived: ${re.requirements.length} role(s).`,
  });
}

/**
 * Rule N-15: the resident — or a coordinator on their behalf — asks for
 * coordinated community help with specific needs. Only then do those needs
 * become capability requirements the engine can staff.
 */
export function requestCommunityHelp(incident: Incident, needIds: string[], actorName: string, actor: "resident" | "coordinator", now: Date): Incident {
  if (!["GUIDED", "OPEN"].includes(incident.status) || incident.missionId) {
    throw new LifecycleError(incident.status === "ESCALATED" ? "Community help can't be sent while a hazard is active — professionals must respond first." : "Help can be requested only before a team is formed.");
  }
  let needs;
  try {
    needs = requestHelp(incident.needs, needIds, now);
  } catch (e) {
    if (e instanceof NavigatorError) throw new LifecycleError(e.message, e.status);
    throw e;
  }
  const requested = needs.filter((n) => needIds.includes(n.id));
  const at = now.toISOString();
  const next = { ...incident, needs };
  const derived = requirementsForNeeds(next, now);
  return log(
    { ...next, ...derived, status: "OPEN" },
    {
      at,
      actor,
      message: `${actorName} requested coordinated help with: ${requested.map((n) => NEED_LABELS[n.type]).join(", ")}. Converted into ${derived.requirements.length} capability requirement(s).`,
    },
  );
}

/** A coordinator records that a referral or human handoff took care of a need. */
export function resolveNeedRecord(incident: Incident, needId: string, actorName: string, note: string, now: Date): Incident {
  let needs;
  try {
    needs = resolveNeed(incident.needs, needId, now);
  } catch (e) {
    if (e instanceof NavigatorError) throw new LifecycleError(e.message, e.status);
    throw e;
  }
  const n = incident.needs.find((x) => x.id === needId)!;
  return log({ ...incident, needs }, { at: now.toISOString(), actor: "coordinator", message: `${actorName} marked “${NEED_LABELS[n.type]}” resolved${note ? `: ${note}` : ""}.` });
}

/** Rule R-C01: an authority clears a hazard; the incident is re-triaged and may become civilian-eligible. */
export function clearHazard(incident: Incident, hazard: Hazard, authority: string, note: string, actorName: string, now: Date): Incident {
  if (!incident.assessment.hazards.includes(hazard)) throw new LifecycleError("Hazard not present on this incident.", 404);
  if (incident.hazardClearances.some((c) => c.hazard === hazard)) return incident;
  const at = now.toISOString();
  const cleared = { ...incident, hazardClearances: [...incident.hazardClearances, { hazard, authority, note, clearedBy: actorName, at }] };
  const re = retriage(cleared, now);
  return log(re, {
    at,
    actor: "coordinator",
    message: `${actorName} recorded that ${authority} cleared the ${HAZARD_LABELS[hazard].toLowerCase()} (${note}). Re-triaged: ${
      re.triage.civilianDispatchAllowed ? `now civilian-eligible, ${re.requirements.length} roles required` : "still requires professional response"
    }.`,
  });
}

/* ------------------------------------------------------------------ */
/* Routing, reassessment, holds                                        */
/* ------------------------------------------------------------------ */

/** Decision records are deterministic for a given mission history and clock. */
function decision(d: Omit<DecisionRecord, "id">): Omit<DecisionRecord, "id"> {
  return d;
}

const withDecision = (m: Mission, d: Omit<DecisionRecord, "id">): Mission => {
  const n = (m.decisions?.length ?? 0) + 1;
  const rec: DecisionRecord = { id: `${m.id}-dec-${Date.parse(d.createdAt).toString(36)}-${n}`, ...d };
  return { ...m, decisions: [...(m.decisions ?? []), rec].slice(-40) };
};

/** While a team is held, the people waiting for it may be at risk. The rules say so; a person decides. */
function welfareNote(incident: Incident): string | undefined {
  const v = new Set(incident.assessment.vulnerabilities);
  const n = new Set(incident.assessment.needs);
  if (n.has("POWER_MEDICAL_DEVICE") || v.has("MEDICAL_DEPENDENCY"))
    return "This household depends on medical equipment or medication. Call them now; if the device or supply fails before the team can move, escalate to EMS (911).";
  if (v.has("MOBILITY_LIMITED") || v.has("OLDER_ADULT") || v.has("ISOLATED"))
    return "This household includes someone who may not be able to shelter or leave unaided. Call them with the warning and check they have a safe place.";
  return undefined;
}

/** Attach the first planned route at dispatch. */
export function attachRoute(incident: Incident, mission: Mission, route: RoutePlan, now: Date): { incident: Incident; mission: Mission } {
  const at = now.toISOString();
  const m = withDecision(
    { ...mission, route, routeHistory: [] },
    decision({
      decisionType: "ROUTE_PLANNED",
      createdAt: at,
      rulesApplied: route.avoided.length ? ["R-01"] : [],
      clusterIds: route.avoided.map((a) => a.clusterId),
      result: `Route v${route.version}: ${route.distanceKm} km, ETA ${route.etaMinutes} min`,
      explanation: `${route.statement}${route.avoided.length ? ` Avoiding: ${route.avoided.map((a) => a.title).join("; ")}.` : ""}`,
      evidence: [],
      by: "rules",
    }),
  );
  return {
    mission: m,
    incident: log(incident, { at, actor: "rules", message: `Route planned for ${mission.code}: ${route.roads.join(" → ") || "direct"} · ${route.distanceKm} km · ETA ${route.etaMinutes} min. ${route.statement}` }),
  };
}

/**
 * Apply a reassessment to a mission. `newRoute` is the route the caller
 * planned for a REROUTE outcome (null = no usable route → R-02 hold).
 */
export function applyAssessment(args: {
  incident: Incident;
  mission: Mission;
  assessment: ReturnType<typeof assessMission>;
  newRoute?: RoutePlan | null;
  /**
   * False when the picture may be incomplete (e.g. a live source has not
   * reported yet): holds may be added but never cleared on missing data.
   */
  allowClear?: boolean;
  now: Date;
}): { incident: Incident; mission: Mission; changed: boolean } {
  const { assessment: a, now } = args;
  let { incident, mission } = args;
  const at = now.toISOString();
  const blocking = a.hits.filter((h) => h.outcome === "HOLD" || h.outcome === "ESCALATE" || h.outcome === "RETURN_TO_SAFE_LOCATION");
  const topBlocking = blocking.find((h) => h.outcome === "ESCALATE") ?? blocking[0];

  if (mission.status === "ON_HOLD" && mission.hold) {
    const current = mission.hold;
    if (topBlocking) {
      // A condition applies. Reinstate a hold that had been marked cleared, or upgrade HOLD → ESCALATE.
      const currentIsEscalation = current.ruleId === "S-01";
      const reinstated = !!current.conditionCleared;
      const upgraded = topBlocking.outcome === "ESCALATE" && !currentIsEscalation;
      if (!reinstated && !upgraded) return { incident, mission, changed: false };
      const hold = { ...holdFrom(topBlocking, now), welfareNote: welfareNote(incident) };
      mission = withDecision(
        { ...mission, hold },
        decision({
          decisionType: topBlocking.outcome,
          createdAt: at,
          rulesApplied: blocking.map((h) => h.ruleId),
          clusterIds: hold.clusterIds,
          result: upgraded ? "Hold escalated — mission suspended" : "Hold reinstated — condition active again",
          explanation: topBlocking.reason,
          evidence: hold.evidence,
          by: "rules",
        }),
      );
      incident = log(incident, {
        at,
        actor: "rules",
        message: `${mission.code} ${upgraded ? "SUSPENDED — professional follow-up recommended" : "HOLD REINSTATED"} (rule ${topBlocking.ruleId}): ${topBlocking.reason} Team instructed: ${topBlocking.instruction}`,
      });
      if (topBlocking.outcome === "ESCALATE") incident = recommendEscalation(incident, topBlocking, at);
      return { incident, mission, changed: true };
    }

    if (current.conditionCleared || args.allowClear === false) return { incident, mission, changed: false };

    // No hold condition applies. If the route is still blocked, the mission may only clear once a route exists.
    const r01 = a.hits.find((h) => h.ruleId === "R-01");
    if (r01 && !args.newRoute) {
      if (current.ruleId === "R-02") return { incident, mission, changed: false };
      const hold = {
        ...holdFrom({ ...r01, ruleId: "R-02", outcome: "HOLD", reason: `No route avoids the known restrictions (${r01.reason})`, instruction: "Wait at your staging point. Do not drive through the closure." }, now),
        welfareNote: welfareNote(incident),
      };
      mission = withDecision(
        { ...mission, hold },
        decision({ decisionType: "HOLD", createdAt: at, rulesApplied: ["H-01", "R-02"], clusterIds: hold.clusterIds, result: "Still held — no usable route", explanation: hold.reason, evidence: hold.evidence, by: "rules" }),
      );
      incident = log(incident, { at, actor: "rules", message: `${mission.code}: ${current.ruleId} condition ended, but still HELD (rule R-02): ${hold.reason}.` });
      return { incident, mission, changed: true };
    }

    let cleared: Mission = { ...mission, hold: { ...current, conditionCleared: true } };
    let explanation = "The condition behind this hold has expired or been withdrawn. A coordinator may resume the mission.";
    if (r01 && args.newRoute) {
      const prev = mission.route;
      const next = { ...args.newRoute, version: (prev?.version ?? 0) + 1 };
      // The team must acknowledge the new route after resuming.
      cleared = {
        ...cleared,
        route: next,
        routeHistory: [...(mission.routeHistory ?? []), ...(prev ? [prev] : [])],
        heldFrom: mission.heldFrom === "IN_PROGRESS" ? "IN_PROGRESS" : "REROUTING",
      };
      explanation += ` ${describeReroute(prev, next, r01.reason)} The team must acknowledge it after resuming.`;
    }
    mission = withDecision(
      cleared,
      decision({ decisionType: "CONTINUE", createdAt: at, rulesApplied: r01 ? ["H-01", "R-01"] : ["H-01"], clusterIds: current.clusterIds, result: "Hold condition cleared", explanation, evidence: current.evidence, by: "rules" }),
    );
    incident = log(incident, { at, actor: "rules", message: `${mission.code}: hold condition cleared (rule H-01)${r01 ? "; new route planned" : ""}. Awaiting coordinator to resume.` });
    return { incident, mission, changed: true };
  }

  if (topBlocking) {
    const hold = { ...holdFrom(topBlocking, now), welfareNote: welfareNote(incident) };
    mission = withDecision(
      { ...mission, status: "ON_HOLD", heldFrom: mission.status, hold },
      decision({ decisionType: topBlocking.outcome, createdAt: at, rulesApplied: a.hits.map((h) => h.ruleId), clusterIds: hold.clusterIds, result: topBlocking.outcome === "ESCALATE" ? "Mission suspended" : "Mission held", explanation: topBlocking.reason, evidence: hold.evidence, by: "rules" }),
    );
    incident = log(incident, {
      at,
      actor: "rules",
      message: `${mission.code} ${topBlocking.outcome === "ESCALATE" ? "SUSPENDED — professional follow-up recommended" : "HELD"} (rule ${topBlocking.ruleId}): ${topBlocking.reason} Team instructed: ${topBlocking.instruction}`,
    });
    if (topBlocking.outcome === "ESCALATE") incident = recommendEscalation(incident, topBlocking, at);
    return { incident, mission, changed: true };
  }

  if (a.outcome === "REROUTE") {
    const hit = a.hits.find((h) => h.ruleId === "R-01")!;
    if (!args.newRoute) {
      const hold = {
        ...holdFrom({ ...hit, ruleId: "R-02", outcome: "HOLD", reason: `No route avoids the known restrictions (${hit.reason})`, instruction: "Wait at your staging point. Do not drive through the closure." }, now),
        welfareNote: welfareNote(incident),
      };
      mission = withDecision(
        { ...mission, status: "ON_HOLD", heldFrom: mission.status, hold },
        decision({ decisionType: "HOLD", createdAt: at, rulesApplied: ["R-01", "R-02"], clusterIds: hold.clusterIds, result: "Mission held — no usable route", explanation: hold.reason, evidence: hold.evidence, by: "rules" }),
      );
      incident = log(incident, { at, actor: "rules", message: `${mission.code} HELD (rule R-02): ${hold.reason}.` });
      return { incident, mission, changed: true };
    }
    const prev = mission.route;
    const next = { ...args.newRoute, version: (prev?.version ?? 0) + 1 };
    const explanation = describeReroute(prev, next, hit.reason);
    mission = withDecision(
      { ...mission, status: "REROUTING", route: next, routeHistory: [...(mission.routeHistory ?? []), ...(prev ? [prev] : [])] },
      decision({ decisionType: "REROUTE", createdAt: at, rulesApplied: ["R-01"], clusterIds: hit.clusters.map((c) => c.id), result: `Route v${next.version}: ETA ${prev?.etaMinutes ?? "?"} → ${next.etaMinutes} min`, explanation, evidence: a.evidence, by: "rules" }),
    );
    incident = log(incident, { at, actor: "rules", message: `${mission.code} REROUTING (rule R-01): ${explanation}` });
    return { incident, mission, changed: true };
  }

  return { incident, mission, changed: false };
}

/** S-01: a no-civilian-entry condition makes professional follow-up a recorded recommendation. */
function recommendEscalation(incident: Incident, hit: { clusters: { type: string }[] }, at: string): Incident {
  const type = hit.clusters[0]?.type;
  const target: EscalationTarget = type === "HAZMAT" ? "HAZMAT_EMERGENCY_MANAGEMENT" : "FIRE_RESCUE_911";
  if (incident.handoffs.some((h) => h.target === target)) return incident;
  return { ...incident, handoffs: [...incident.handoffs, recommendedHandoff(target, at)] };
}

/** The team (or coordinator) confirms they have the new route. */
export function acknowledgeRoute(incident: Incident, mission: Mission, actorName: string, now: Date) {
  if (mission.status !== "REROUTING") throw new LifecycleError(`${mission.code} has no pending route change.`);
  const at = now.toISOString();
  return {
    mission: withDecision({ ...mission, status: "DISPATCHED" as const }, decision({ decisionType: "ROUTE_ACKNOWLEDGED", createdAt: at, rulesApplied: [], clusterIds: [], result: `Route v${mission.route?.version} acknowledged`, explanation: `${actorName} confirmed the team is following the updated route.`, evidence: [], by: actorName })),
    incident: log(incident, { at, actor: "volunteer", message: `${actorName} acknowledged route v${mission.route?.version} for ${mission.code}.` }),
  };
}

/**
 * Coordinator resumes a held mission. Hard safety holds cannot be overridden:
 * the rule's condition must have cleared first (H-01).
 */
export function resumeMission(incident: Incident, mission: Mission, actorName: string, now: Date) {
  if (mission.status !== "ON_HOLD" || !mission.hold) throw new LifecycleError(`${mission.code} is not on hold.`);
  if (!mission.hold.conditionCleared) {
    throw new LifecycleError(`The condition behind this hold is still active (rule ${mission.hold.ruleId}). Safety holds cannot be overridden from the dashboard.`, 409);
  }
  const at = now.toISOString();
  const status = mission.heldFrom && mission.heldFrom !== "ON_HOLD" ? mission.heldFrom : "DISPATCHED";
  return {
    mission: withDecision(
      { ...mission, status, hold: undefined, heldFrom: undefined },
      decision({ decisionType: "RESUME", createdAt: at, rulesApplied: ["H-01"], clusterIds: mission.hold.clusterIds, result: `Resumed (${status.toLowerCase()})`, explanation: `${actorName} resumed the mission after the hold condition cleared.`, evidence: [], by: actorName }),
    ),
    incident: log(incident, { at, actor: "coordinator", message: `${actorName} resumed ${mission.code} after the hold condition cleared.` }),
  };
}
