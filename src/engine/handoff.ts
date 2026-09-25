import { getService } from "@/data/assistanceDirectory";
import type { ServiceType } from "@/domain/assistance";
import { DESTINATION_LABELS, ESCALATION_DESTINATION, ESCALATION_LABELS, HAZARD_LABELS, NEED_LABELS, VULNERABILITY_LABELS } from "@/domain/catalog";
import type { EscalationTarget, Handoff, Incident, Need } from "@/domain/types";

/**
 * Human escalation. CoORDINATE has no connection to 911, utilities, shelters or
 * caseworkers: it explains WHY an escalation is recommended, WHO should get it,
 * and WHAT to hand off — then a person makes the contact and records it.
 */

export function recommendedHandoff(target: EscalationTarget, at: string, extra: Partial<Handoff> = {}): Handoff {
  return { target, status: "RECOMMENDED", at, integration: "none", destination: ESCALATION_DESTINATION[target], ...extra };
}

/** The directory entry that fits the destination (never "911" as the contact for a utility). */
const SERVICE_FOR_TARGET: Partial<Record<EscalationTarget, ServiceType[]>> = {
  EMS_911: ["EMERGENCY_SERVICES"],
  FIRE_RESCUE_911: ["EMERGENCY_SERVICES"],
  LAW_ENFORCEMENT_911: ["EMERGENCY_SERVICES"],
  SWIFT_WATER_RESCUE_911: ["EMERGENCY_SERVICES"],
  ELECTRIC_UTILITY: ["UTILITY_OUTAGE"],
  SHELTER_COORDINATOR: ["SHELTER"],
  HUMAN_CASEWORKER: ["CASE_MANAGEMENT"],
  COMMUNITY_COORDINATOR: ["INFORMATION_REFERRAL"],
};

function serviceFor(target: EscalationTarget, candidates: string[]): string | undefined {
  const types = SERVICE_FOR_TARGET[target];
  if (!types) return undefined;
  return candidates.find((id) => getService(id)?.serviceTypes.some((t) => types.includes(t)));
}

/** One handoff per target across all needs on an escalation path; existing records are kept. */
export function handoffsFromNeeds(existing: Handoff[], needs: Need[], at: string): Handoff[] {
  const out: Handoff[] = existing.map((h) => ({ ...h, destination: h.destination ?? ESCALATION_DESTINATION[h.target] }));
  for (const need of needs) {
    if (need.path !== "PROFESSIONAL_RESPONSE" && need.path !== "HUMAN_ESCALATION") continue;
    // Suggestions (N-14) are offered to the resident, never escalated on their behalf.
    if (need.status === "RESOLVED" || need.origin === "SUGGESTED") continue;
    for (const target of need.escalateTo) {
      const i = out.findIndex((h) => h.target === target);
      if (i >= 0) {
        const h = out[i];
        out[i] = {
          ...h,
          needIds: [...new Set([...(h.needIds ?? []), need.id])],
          ruleId: h.ruleId ?? need.ruleId,
          reason: h.reason ?? need.reason,
          serviceId: h.serviceId ?? serviceFor(target, need.serviceIds),
        };
      } else {
        out.push(recommendedHandoff(target, at, { ruleId: need.ruleId, reason: need.reason, needIds: [need.id], serviceId: serviceFor(target, need.serviceIds) }));
      }
    }
  }
  return out;
}

/** Deterministic handoff summary — what a coordinator reads out or pastes when making contact. */
export function templateHandoffSummary(incident: Incident, h: Handoff): string {
  const needs = incident.needs.filter((n) => h.needIds?.includes(n.id));
  const hazards = incident.assessment.hazards.filter((x) => !incident.hazardClearances.some((c) => c.hazard === x));
  const told = [...new Set(needs.flatMap((n) => n.guidance))].slice(0, 2);
  const svc = h.serviceId ? getService(h.serviceId) : undefined;
  const quote = incident.request.text.replace(/\s+/g, " ").trim();
  const lines = [
    `To: ${ESCALATION_LABELS[h.target]} (${DESTINATION_LABELS[h.destination ?? ESCALATION_DESTINATION[h.target]]})${svc ? ` — suggested contact: ${svc.name}, ${svc.contactMethods[0]?.value}` : ""}`,
    `Why: ${h.reason ?? "Recommended by the safety rules."}${h.ruleId ? ` [${h.ruleId}]` : ""}`,
    `Request ${incident.number}, received ${new Date(incident.createdAt).toISOString().slice(11, 16)} UTC via ${incident.source === "PHONE_TRIAGE" ? "phone triage" : incident.source === "COORDINATOR" ? "coordinator entry" : "resident app"}.`,
    `Location: ${incident.locationLabel} (approximate).`,
    `People: ${incident.assessment.peopleAffected}${incident.assessment.vulnerabilities.length ? `; household: ${incident.assessment.vulnerabilities.map((v) => VULNERABILITY_LABELS[v].toLowerCase()).join(", ")}` : ""}.`,
    `Hazards: ${hazards.length ? hazards.map((x) => HAZARD_LABELS[x]).join(", ") : "none reported"}.`,
    `Needs for you: ${needs.length ? needs.map((n) => NEED_LABELS[n.type]).join(", ") : "see request"}.`,
    ...(told.length ? [`Resident was told: ${told.join(" ")}`] : []),
    `Reported words: “${quote.length > 180 ? `${quote.slice(0, 177)}…` : quote}”`,
    "Status: recommended by CoORDINATE; no agency or person has been contacted by the system.",
  ];
  return lines.join("\n");
}

/** Attach template summaries to handoffs that don't have one yet. */
export function withHandoffSummaries(incident: Incident, at: string): Incident {
  return {
    ...incident,
    handoffs: incident.handoffs.map((h) => (h.summary ? h : { ...h, summary: { text: templateHandoffSummary(incident, h), provider: "local-rules", at } })),
  };
}
