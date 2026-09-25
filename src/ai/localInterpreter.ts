import { HAZARD_LABELS, NEED_LABELS } from "@/domain/catalog";
import type { Hazard, IncidentCategory, IncidentProposal, IntakeRequest, NeedType, Vulnerability } from "@/domain/types";
import { needCategory } from "@/engine/validate";
import { assertedHazards, scanHazards, scanNeeds, scanPeopleCount, scanVulnerabilities } from "@/engine/textScan";

/**
 * Local, deterministic interpreter used when Azure AI Foundry is not
 * configured (or fails). Keyword-based — adequate for the demo scenario and
 * guaranteed to run offline. Output has the exact same shape as Foundry's.
 */
export function interpretLocally(req: IntakeRequest): IncidentProposal {
  const text = req.text;
  const mentions = scanHazards(text);
  const hazards = assertedHazards(mentions);
  const needs = scanNeeds(text);
  const vulnerabilities = scanVulnerabilities(text);
  const category = pickCategory(needs, req.categoryHint);
  const people = req.peopleAffected ?? scanPeopleCount(text) ?? 1;
  const immediateLifeThreat = hazards.some((h) => h === "MEDICAL_EMERGENCY" || h === "SWIFT_WATER" || h === "ACTIVE_FIRE" || h === "VIOLENCE");

  const summary = describe(needs, hazards, vulnerabilities, people);
  return {
    category,
    summary,
    peopleAffected: people,
    hazards,
    immediateLifeThreat,
    vulnerabilities,
    needs,
    requestedHelp: needs.map((n) => NEED_LABELS[n]),
    language: req.language && /^[a-z]{2}$/.test(req.language) ? req.language : /\b(?:ayuda|por favor|agua|necesitamos)\b/i.test(text) ? "es" : "en",
    confidence: needs.length ? 0.7 : 0.35,
  };
}

function pickCategory(needs: NeedType[], hint?: IncidentCategory): IncidentCategory {
  if (hint) return hint;
  if (needs.length === 0) return "OTHER";
  const tally = new Map<IncidentCategory, number>();
  for (const n of needs) tally.set(needCategory(n), (tally.get(needCategory(n)) ?? 0) + 1);
  // Ties resolved by the order needs appear in the vocabulary (most operationally specific first).
  return Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

const NEED_PHRASE: [NeedType[], string][] = [
  [["TREE_CUTTING", "ACCESS_BLOCKED"], "Tree down blocking access"],
  [["POWER_MEDICAL_DEVICE"], "Power needed for a medical device"],
  [["REFRIGERATION"], "Medication needs refrigeration"],
  [["ROOF_TARP"], "Roof damaged, rain entering home"],
  [["MUCK_OUT"], "Flood-damaged interior needs muck-out"],
  [["WATER_MITIGATION", "MOVE_BELONGINGS"], "Water in basement, belongings need moving"],
  [["WATER_MITIGATION"], "Water entering home"],
  [["MOVE_BELONGINGS"], "Help moving belongings"],
  [["TREE_CUTTING"], "Tree down on property"],
  [["DEBRIS_REMOVAL"], "Storm debris removal"],
  [["ACCESS_BLOCKED"], "Access blocked"],
  [["SHELTER"], "Household displaced, needs shelter tonight"],
  [["WELLNESS_CHECK"], "Resident unreachable — wellness check requested"],
  [["TRANSPORTATION"], "Needs transportation"],
  [["FOOD", "WATER"], "Needs food and drinking water"],
  [["WATER"], "Needs drinking water"],
  [["FOOD"], "Needs food"],
  [["MEDICATION"], "Needs medication pickup"],
  [["DEVICE_CHARGING"], "No power — phones need charging"],
  [["GENERATOR_POWER"], "Facility needs a generator connected by a licensed electrician"],
  [["SHELTER_STAFFING"], "Shelter needs volunteer staff"],
];

const VULN_PHRASE: Record<Vulnerability, string> = {
  MOBILITY_LIMITED: "wheelchair / mobility limits",
  MEDICAL_DEPENDENCY: "medical dependency",
  OLDER_ADULT: "older adult",
  CHILDREN: "children present",
  ISOLATED: "lives alone",
  LANGUAGE_ACCESS: "language access need",
  DISABILITY_OTHER: "disability",
};

/** Plain-language one-line summary built from extracted codes. */
function describe(needs: NeedType[], hazards: Hazard[], vulnerabilities: Vulnerability[], people: number): string {
  const phrase = NEED_PHRASE.find(([req]) => req.every((n) => needs.includes(n)))?.[1];
  const who = `${people} ${people === 1 ? "person" : "people"}${vulnerabilities.length ? `; ${vulnerabilities.slice(0, 2).map((v) => VULN_PHRASE[v]).join(", ")}` : ""}`;
  if (hazards.length) {
    const h = hazards.map((x) => HAZARD_LABELS[x]).join(" + ");
    return `${h} reported${phrase ? ` — ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}` : ""}`;
  }
  return `${phrase ?? (needs.length ? needs.map((n) => NEED_LABELS[n]).join(", ") : "Request for assistance")} — ${who}`;
}
