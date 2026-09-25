import { workspaceMode } from "@/data/mode";
import { ESCALATION_LABELS, HAZARD_LABELS, NEED_LABELS, PRIORITY_LABELS, RESOLUTION_PATH_LABELS, TRIAGE_LABELS } from "@/domain/catalog";
import type { GeoPoint, Incident, IncidentStatus, IntakeRequest, Interpretation, Need, NeedType, TimelineEvent } from "@/domain/types";
import { handoffsFromNeeds, withHandoffSummaries } from "./handoff";
import { decomposeNeeds, EXERCISE_CONTEXT, hasRequestedHelp, isMissionNeed, LIVE_CONTEXT, missionNeedTypes, refreshNeeds, type NavigatorContext } from "./navigator";
import { computePriority } from "./priority";
import { assessIncident } from "./requirements";
import { scanHazards } from "./textScan";
import { buildAdvisories, isEscalated, triage as runTriage } from "./triage";
import { validateProposal } from "./validate";

export { recommendedHandoff } from "./handoff";

/** Live workspaces never see exercise-only services, and declaration status is unknown there. */
export function navigatorContextFor(workspaceId: string): NavigatorContext {
  return workspaceMode(workspaceId) === "LIVE" ? LIVE_CONTEXT : EXERCISE_CONTEXT;
}

/**
 * The intake pipeline, as a pure function:
 *
 *   AI proposal → deterministic validation → safety triage → NEEDS, each with
 *   a resolution path (navigator) → capability requirements for the community
 *   needs → priority → advisories → handoffs (WHY / WHO / WHAT)
 *
 * Used by the live API and by the seed builder, so seeded incidents are
 * produced by exactly the same logic judges exercise in the demo.
 */
export function buildIncident(args: {
  id: string;
  number: string;
  workspaceId: string;
  source: Incident["source"];
  request: IntakeRequest;
  location: GeoPoint;
  locality: string;
  locationLabel: string;
  interpretation: Interpretation;
  raw: unknown;
  now: Date;
}): Incident {
  const { request, now } = args;
  const at = now.toISOString();
  const mentions = scanHazards(request.text);
  const { proposal, assessment, notes, unrecognizedHazards, aiEvidence } = validateProposal(args.raw, request, mentions);
  const firstPass = runTriage({ assessment, immediateDangerReported: request.immediateDanger, clearances: [], now });
  const needs = decomposeNeeds({
    incidentId: args.id,
    assessment,
    triage: firstPass,
    request,
    location: args.location,
    clearances: [],
    aiEvidence,
    context: navigatorContextFor(args.workspaceId),
    now,
  });
  const { triage, requirements } = assessIncident({
    assessment,
    immediateDangerReported: request.immediateDanger,
    clearances: [],
    missionNeeds: missionNeedTypes(needs),
    now,
  });
  const advisories = buildAdvisories(assessment, mentions);
  if (unrecognizedHazards.length) {
    advisories.push({
      id: "adv-unrecognized-hazard",
      ruleId: "R-A03",
      message: `The AI reported hazard(s) outside the rule book: ${unrecognizedHazards.map((h) => `“${h}”`).join(", ")}. Review before dispatching anyone.`,
      requiresAcknowledgement: true,
    });
  }
  const priority = computePriority(assessment, triage);
  const escalated = isEscalated(triage);
  const infoOnly = triage.level === "INFORMATION_ONLY";
  const handoffs = handoffsFromNeeds([], needs, at);

  const timeline: TimelineEvent[] = [
    { at, actor: "resident", message: `Request received via ${args.source === "PHONE_TRIAGE" ? "phone triage" : args.source === "COORDINATOR" ? "coordinator entry" : "resident app"}.` },
    {
      at,
      actor: "ai",
      message:
        args.interpretation.provider === "azure-ai-foundry"
          ? `Azure AI Foundry (${args.interpretation.model}) proposed a structured incident in ${args.interpretation.latencyMs} ms.`
          : `Local rules interpreter proposed a structured incident${args.interpretation.fallbackReason ? " (Foundry fallback)" : ""}.`,
    },
    {
      at,
      actor: "rules",
      message: `Validation applied ${notes.length} correction(s). Triage: ${TRIAGE_LABELS[triage.level].label}. Priority ${priority.level} (${PRIORITY_LABELS[priority.level]}).`,
    },
  ];
  timeline.push({ at, actor: "rules", message: `Navigator: ${describeNeeds(needs)}.` });
  if (escalated) {
    timeline.push({
      at,
      actor: "rules",
      message: `Civilian dispatch prohibited${assessment.hazards.length ? ` — ${assessment.hazards.map((h) => HAZARD_LABELS[h]).join(", ")}` : ""}. No community mission created. Professional escalation recommended: ${handoffs.map((h) => ESCALATION_LABELS[h.target]).join(", ")}. CoORDINATE has no connection to these agencies — a coordinator must make and record the contact.`,
    });
  } else if (infoOnly) {
    timeline.push({ at, actor: "rules", message: "Information-only report (rule R-I01): no mission created. Added to the operational picture as an unverified community report." });
  } else if (needs.some(isMissionNeed)) {
    timeline.push({ at, actor: "rules", message: `Community help offered for ${needs.filter(isMissionNeed).map((n) => NEED_LABELS[n.type]).join(", ")} — waiting for the resident to request it (N-15). ${requirements.length} capability requirement(s) previewed.` });
  }
  if (advisories.length) timeline.push({ at, actor: "rules", message: `${advisories.length} safety advisory(ies) require coordinator acknowledgement.` });

  const incident: Incident = {
    id: args.id,
    workspaceId: args.workspaceId,
    number: args.number,
    createdAt: at,
    updatedAt: at,
    source: args.source,
    request,
    location: args.location,
    locality: args.locality,
    locationLabel: args.locationLabel,
    interpretation: { ...args.interpretation, proposal },
    hazardMentions: mentions,
    validation: notes,
    assessment,
    hazardClearances: [],
    advisories,
    triage,
    requirements,
    priority,
    status: escalated ? "ESCALATED" : infoOnly ? "LOGGED" : hasRequestedHelp(needs) ? "OPEN" : "GUIDED",
    handoffs,
    needs,
    offers: [],
    timeline,
  };
  return withHandoffSummaries(incident, at);
}

function describeNeeds(needs: Need[]): string {
  return `${needs.length} need(s) — ${needs.map((n) => `${NEED_LABELS[n.type]}${n.origin === "SUGGESTED" ? " (suggested)" : ""} → ${RESOLUTION_PATH_LABELS[n.path].label}`).join("; ")}`;
}

/** Status of an incident that has no mission yet, from its triage and needs. */
function preMissionStatus(incident: Pick<Incident, "triage" | "needs">): IncidentStatus {
  if (isEscalated(incident.triage)) return "ESCALATED";
  if (incident.triage.level === "INFORMATION_ONLY") return "LOGGED";
  return hasRequestedHelp(incident.needs) ? "OPEN" : "GUIDED";
}

/** Re-derive needs (keeping what already happened to each) and the requirements that follow from them. */
export function renavigate(incident: Incident, now: Date): Incident {
  const aiEvidence: Partial<Record<NeedType, string>> = {};
  for (const n of incident.needs ?? []) {
    const ai = n.evidence.find((e) => e.by === "AI");
    if (ai) aiEvidence[n.type] = ai.phrase;
  }
  const firstPass = runTriage({ assessment: incident.assessment, immediateDangerReported: incident.request.immediateDanger, clearances: incident.hazardClearances, now });
  const fresh = decomposeNeeds({
    incidentId: incident.id,
    assessment: incident.assessment,
    triage: firstPass,
    request: incident.request,
    location: incident.location,
    clearances: incident.hazardClearances,
    aiEvidence,
    context: navigatorContextFor(incident.workspaceId),
    now,
  });
  return { ...incident, needs: refreshNeeds(incident.needs ?? [], fresh, incident.id, now) };
}

/** Recompute triage/requirements/priority after a hazard clearance. Keeps history in the timeline. */
export function retriage(incident: Incident, now: Date): Incident {
  const navigated = renavigate(incident, now);
  const { triage, requirements } = assessIncident({
    assessment: incident.assessment,
    immediateDangerReported: incident.request.immediateDanger,
    clearances: incident.hazardClearances,
    missionNeeds: missionNeedTypes(navigated.needs),
    now,
  });
  const priority = computePriority(incident.assessment, triage);
  const preMission = ["ESCALATED", "LOGGED", "GUIDED", "OPEN"].includes(incident.status);
  const status = preMission ? preMissionStatus({ triage, needs: navigated.needs }) : incident.status;
  // New escalation needs get a recommendation; existing records are kept.
  const handoffs = handoffsFromNeeds(incident.handoffs, navigated.needs, now.toISOString());
  return withHandoffSummaries({ ...navigated, triage, requirements, priority, status, handoffs, updatedAt: now.toISOString() }, now.toISOString());
}

/** Rule N-15 applied to the incident: requirements now follow the requested needs. */
export function requirementsForNeeds(incident: Incident, now: Date): Pick<Incident, "triage" | "requirements" | "priority"> {
  const { triage, requirements } = assessIncident({
    assessment: incident.assessment,
    immediateDangerReported: incident.request.immediateDanger,
    clearances: incident.hazardClearances,
    missionNeeds: missionNeedTypes(incident.needs),
    now,
  });
  return { triage, requirements, priority: computePriority(incident.assessment, triage) };
}
