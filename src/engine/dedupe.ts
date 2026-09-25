import type { Advisory, Incident } from "@/domain/types";
import { distanceKm } from "./geo";

/**
 * Possible-duplicate detection (rule R-A04). Deterministic and conservative:
 * it never merges or closes anything — it asks a coordinator to check before
 * a second team is sent to the same job.
 *
 * A prior incident is a possible duplicate when it is still open or active,
 * within 150 m, reported in the last 12 hours, and shares a need (or both
 * are information-only road reports).
 */
const RADIUS_KM = 0.15;
const WINDOW_H = 12;
const OPEN = new Set(["OPEN", "TEAM_FORMING", "ACTIVE", "ESCALATED", "LOGGED"]);

export function findPossibleDuplicates(incident: Incident, others: Incident[]): Incident[] {
  const t = new Date(incident.createdAt).getTime();
  const needs = new Set(incident.assessment.needs);
  return others.filter((o) => {
    if (o.id === incident.id || !OPEN.has(o.status)) return false;
    if (Math.abs(t - new Date(o.createdAt).getTime()) > WINDOW_H * 3600e3) return false;
    if (distanceKm(o.location, incident.location) > RADIUS_KM) return false;
    const bothReports = incident.status === "LOGGED" && o.status === "LOGGED";
    return bothReports || o.assessment.needs.some((n) => needs.has(n)) || (!needs.size && !o.assessment.needs.length);
  });
}

export function duplicateAdvisory(dups: Incident[]): Advisory | null {
  if (!dups.length) return null;
  return {
    id: "adv-possible-duplicate",
    ruleId: "R-A04",
    message: `Possible duplicate of ${dups.map((d) => `${d.number} (${d.locationLabel})`).join(", ")} — same place and need within 12 hours. Check with the resident before sending a second team.`,
    requiresAcknowledgement: true,
  };
}
