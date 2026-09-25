import { NEED_LABELS, TRIAGE_LABELS, VULNERABILITY_LABELS } from "@/domain/catalog";
import type { Incident, Mission, Responder } from "@/domain/types";

/**
 * Deterministic text templates — used when Azure AI Foundry is not configured,
 * when it fails, and for seeding. Safety lines are always deterministic.
 */

/** Deterministic safety lines appended to every briefing, regardless of AI output. */
export function safetyLines(incident: Incident): string[] {
  const lines = [
    "Stop work and call the coordinator if you see downed lines, smell gas, or conditions change.",
    "Do not enter flooded rooms until power to them is confirmed off.",
  ];
  if (incident.requirements.some((s) => s.skill === "CHAINSAW_OPERATION")) lines.push("Only the credentialed operator runs the saw. Everyone else stays outside the cut zone (two tree lengths).");
  if (incident.assessment.vulnerabilities.some((v) => v === "MOBILITY_LIMITED" || v === "OLDER_ADULT")) lines.push("Ask before assisting anyone with mobility equipment; never lift a person.");
  if (incident.assessment.needs.includes("POWER_MEDICAL_DEVICE")) lines.push("Never run a generator indoors or in a garage. Use the battery station inside.");
  return lines;
}

export function templateBriefing(incident: Incident, mission: Mission, responders: Responder[]): string {
  const byId = new Map(responders.map((r) => [r.id, r]));
  const roles = new Map<string, string[]>();
  for (const a of mission.assignments) {
    const label = incident.requirements.find((s) => s.id === a.slotId)?.label ?? a.slotId;
    roles.set(a.responderId, [...(roles.get(a.responderId) ?? []), label]);
  }
  const team = [...roles.entries()].map(([id, r]) => `${byId.get(id)?.name ?? id} (${r.join(", ").toLowerCase()})`).join("; ");
  const v = incident.assessment.vulnerabilities.map((x) => VULNERABILITY_LABELS[x].toLowerCase());
  return [
    `${incident.assessment.summary}. Location: ${incident.locationLabel}.`,
    `Tasks: ${incident.assessment.needs.map((n) => NEED_LABELS[n].toLowerCase()).join(", ")}.${v.length ? ` Household: ${v.join(", ")} — introduce yourselves and ask how best to help.` : ""}`,
    `Team: ${team}.`,
    ...(mission.dispatchedWithout
      ? [`Going without: ${mission.dispatchedWithout.labels.join(", ").toLowerCase()} — plan the work accordingly.${mission.dispatchedWithout.note ? ` Coordinator note: ${mission.dispatchedWithout.note}` : ""}`]
      : []),
    `Triage: ${TRIAGE_LABELS[incident.triage.level].label}.`,
  ].join(" ");
}

/** Deterministic safety block appended to every briefing, whoever wrote the narrative. */
export function withSafety(text: string, incident: Incident): string {
  return `${text.trim()}\n\nSafety (always applies):\n${safetyLines(incident).map((l) => `• ${l}`).join("\n")}`;
}

export interface SitrepStats {
  operation: string;
  counts: Record<string, number>;
  peopleHelped: number;
  unmetPeople: number;
  topNeeds: { need: string; count: number }[];
  gaps: string[];
  escalations: { hazard: string; count: number }[];
  p1Open: string[];
  activeVolunteers: number;
  /** Operational conditions (official or corroborated only) and their effect on missions. */
  conditions?: { title: string; status: string; effect: string; simulated: boolean }[];
  heldMissions?: string[];
  reroutedMissions?: string[];
  unverifiedReports?: number;
}

export function templateSitrep(s: SitrepStats): string {
  const lines = [
    `• ${s.counts.ESCALATED ?? 0} incidents escalated to professional responders${s.escalations.length ? ` (${s.escalations.map((e) => `${e.count} ${e.hazard.toLowerCase()}`).join(", ")})` : ""}.`,
    `• ${(s.counts.OPEN ?? 0) + (s.counts.AWAITING_RESOURCES ?? 0)} community requests open; ${s.counts.AWAITING_RESOURCES ?? 0} awaiting resources.${s.p1Open.length ? ` Critical: ${s.p1Open.slice(0, 2).join("; ")}.` : ""}`,
    `• ${s.counts.ACTIVE ?? 0} missions active, ${s.counts.TEAM_FORMING ?? 0} teams forming, ${s.activeVolunteers} volunteers deployed.`,
    `• ${s.counts.RESOLVED ?? 0} requests completed and verified; ${s.peopleHelped} people helped, ${s.unmetPeople} still waiting.`,
  ];
  if (s.topNeeds.length) lines.push(`• Top open needs: ${s.topNeeds.slice(0, 3).map((n) => `${n.need} (${n.count})`).join(", ")}.`);
  if (s.gaps.length) lines.push(`• Capability gaps: ${s.gaps.slice(0, 3).join("; ")}.`);
  if (s.heldMissions?.length) lines.unshift(`• ${s.heldMissions.length} mission(s) held for safety: ${s.heldMissions.slice(0, 3).join("; ")}.`);
  if (s.reroutedMissions?.length) lines.push(`• Rerouted around closures: ${s.reroutedMissions.slice(0, 3).join("; ")}.`);
  if (s.conditions?.length) lines.push(`• Conditions in effect: ${s.conditions.slice(0, 3).map((c) => `${c.title} (${c.effect})`).join("; ")}.`);
  if (s.unverifiedReports) lines.push(`• ${s.unverifiedReports} unverified report(s) awaiting corroboration — not acted on.`);
  return lines.join("\n");
}

