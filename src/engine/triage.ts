import { CREDENTIAL_LABELS, HAZARD_LABELS } from "@/domain/catalog";
import type {
  Advisory,
  Assessment,
  EscalationTarget,
  HazardClearance,
  HazardMention,
  RequirementSlot,
  RuleFiring,
  TriageLevel,
  TriageResult,
} from "@/domain/types";
import { CIVILIAN_PROHIBITED_ROLES, HAZARD_RULES, VULNERABLE_OCCUPANT } from "./rules";
import { negatedHazardsNeedingReview, unique } from "./textScan";

/** Credentials that are baseline screening, not specialist training. They don't raise the tier. */
const BASELINE_CREDENTIALS = new Set(["BACKGROUND_CHECK", "DRIVERS_LICENSE"]);
/** State-licensed trades: roles requiring them make the incident SPECIALIZED_VOLUNTEER_ELIGIBLE. */
const LICENSED_CREDENTIALS = new Set(["LICENSED_ELECTRICIAN"]);

/** Least to most restrictive. */
const LEVEL_ORDER: TriageLevel[] = [
  "INFORMATION_ONLY",
  "GENERAL_VOLUNTEER_ELIGIBLE",
  "TRAINED_VOLUNTEER_ELIGIBLE",
  "SPECIALIZED_VOLUNTEER_ELIGIBLE",
  "PROFESSIONAL_RESPONSE_REQUIRED",
  "LIFE_SAFETY_EMERGENCY",
];

const CIVILIAN_LEVELS: TriageLevel[] = ["GENERAL_VOLUNTEER_ELIGIBLE", "TRAINED_VOLUNTEER_ELIGIBLE", "SPECIALIZED_VOLUNTEER_ELIGIBLE"];

/** Hazard/emergency escalation (as opposed to "no mission needed"). */
export function isEscalated(t: Pick<TriageResult, "level">): boolean {
  return t.level === "LIFE_SAFETY_EMERGENCY" || t.level === "PROFESSIONAL_RESPONSE_REQUIRED";
}

export interface TriageInput {
  assessment: Assessment;
  immediateDangerReported: boolean;
  clearances: HazardClearance[];
  requirements?: RequirementSlot[];
  now: Date;
}

/**
 * Deterministic safety triage. Pure function: same inputs → same result.
 *
 * Order of precedence (highest wins):
 *   LIFE_SAFETY_EMERGENCY > PROFESSIONAL_RESPONSE_REQUIRED > SPECIALIZED > TRAINED > GENERAL > INFORMATION_ONLY
 */
export function triage(input: TriageInput): TriageResult {
  const { assessment, clearances } = input;
  const rulesFired: RuleFiring[] = [];
  const escalateTo: EscalationTarget[] = [];
  const guidance: string[] = [];
  const infoOnly = !!assessment.informationOnly && assessment.needs.length === 0;
  let level: TriageLevel = infoOnly ? "INFORMATION_ONLY" : "GENERAL_VOLUNTEER_ELIGIBLE";

  const raise = (to: TriageLevel) => {
    if (LEVEL_ORDER.indexOf(to) > LEVEL_ORDER.indexOf(level)) level = to;
  };

  if (input.immediateDangerReported) {
    raise("LIFE_SAFETY_EMERGENCY");
    escalateTo.push("EMS_911");
    guidance.push("If anyone is in danger right now, call 911.");
    rulesFired.push({
      ruleId: "R-L01",
      title: "Resident reports immediate danger",
      detail: "Requester indicated someone is in immediate danger.",
      effect: "ESCALATE",
    });
  } else if (assessment.immediateLifeThreat) {
    raise("LIFE_SAFETY_EMERGENCY");
    escalateTo.push("EMS_911");
    guidance.push("If anyone is in danger right now, call 911.");
    rulesFired.push({
      ruleId: "R-L02",
      title: "AI flagged immediate life threat",
      detail: "The interpretation layer may escalate an incident; it can never de-escalate one.",
      effect: "ESCALATE",
    });
  }

  const cleared = new Set(clearances.map((c) => c.hazard));
  for (const hazard of assessment.hazards) {
    const rule = HAZARD_RULES[hazard];
    if (cleared.has(hazard)) {
      const c = clearances.find((x) => x.hazard === hazard)!;
      rulesFired.push({
        ruleId: "R-C01",
        title: `${rule.title} — cleared`,
        detail: `${c.authority} cleared this hazard (${c.note}). Recorded by ${c.clearedBy}.`,
        effect: "PERMIT",
      });
      continue;
    }
    raise(rule.level);
    escalateTo.push(...rule.escalateTo);
    guidance.push(rule.guidance);
    rulesFired.push({
      ruleId: rule.id,
      title: rule.title,
      detail: `${HAZARD_LABELS[hazard]} present → ${rule.level === "LIFE_SAFETY_EMERGENCY" ? "life-safety emergency" : "professional response required"}. Civilian dispatch prohibited.`,
      effect: "ESCALATE",
    });
  }

  if (level === "INFORMATION_ONLY") {
    rulesFired.push({
      ruleId: "R-I01",
      title: "Information-only report",
      detail: "The reporter describes a road/area condition and asks for no help. No mission is created; the report joins the operational picture as an unverified community report.",
      effect: "ADVISE",
    });
  }

  const civilianDispatchAllowed = CIVILIAN_LEVELS.includes(level);

  if (civilianDispatchAllowed && input.requirements) {
    const specialist = unique(
      input.requirements.flatMap((s) => s.credentials).filter((c) => !BASELINE_CREDENTIALS.has(c)),
    );
    const licensed = specialist.filter((c) => LICENSED_CREDENTIALS.has(c));
    if (licensed.length > 0) {
      raise("SPECIALIZED_VOLUNTEER_ELIGIBLE");
      rulesFired.push({
        ruleId: "R-T02",
        title: "Licensed trade required",
        detail: `Roles require a verified state license: ${licensed.map((c) => CREDENTIAL_LABELS[c]).join(", ")}. Unlicensed volunteers cannot fill them.`,
        effect: "REQUIRE",
      });
    }
    if (specialist.length > 0) {
      raise("TRAINED_VOLUNTEER_ELIGIBLE");
      rulesFired.push({
        ruleId: "R-T01",
        title: "Credentialed roles required",
        detail: `Roles require verified: ${specialist.map((c) => CREDENTIAL_LABELS[c]).join(", ")}.`,
        effect: "REQUIRE",
      });
    } else {
      rulesFired.push({
        ruleId: "R-T01",
        title: "No specialist credentials required",
        detail: "Identity-verified community volunteers may perform this mission.",
        effect: "PERMIT",
      });
    }
  }

  const vulnerable = assessment.vulnerabilities.filter((v) => VULNERABLE_OCCUPANT.includes(v));
  if (civilianDispatchAllowed && vulnerable.length && input.requirements?.some((s) => s.kind === "PERSON")) {
    rulesFired.push({
      ruleId: "R-V01",
      title: "Vulnerable occupant",
      detail: `Household includes: ${vulnerable.map((v) => v.replace(/_/g, " ").toLowerCase()).join(", ")}. Everyone going on-site needs a verified ${CREDENTIAL_LABELS.BACKGROUND_CHECK.toLowerCase()}.`,
      effect: "REQUIRE",
    });
  }

  return {
    level,
    civilianDispatchAllowed,
    rulesFired,
    escalateTo: unique(escalateTo),
    doNotDispatch: civilianDispatchAllowed || level === "INFORMATION_ONLY" ? [] : CIVILIAN_PROHIBITED_ROLES,
    guidance: unique(guidance),
    evaluatedAt: input.now.toISOString(),
  };
}

/** Advisories requiring human acknowledgement before dispatch (rules R-A01, R-A02). */
export function buildAdvisories(assessment: Assessment, mentions: HazardMention[]): Advisory[] {
  const advisories: Advisory[] = [];
  for (const m of negatedHazardsNeedingReview(mentions)) {
    if (assessment.hazards.includes(m.hazard)) continue;
    advisories.push({
      id: `adv-${m.hazard.toLowerCase()}`,
      ruleId: "R-A01",
      message: `Request mentions “${m.phrase}” in a negated context. Confirm with the resident that there is no ${HAZARD_LABELS[m.hazard].toLowerCase()} before dispatching volunteers.`,
      requiresAcknowledgement: true,
    });
  }
  if (assessment.needs.includes("POWER_MEDICAL_DEVICE")) {
    advisories.push({
      id: "adv-life-sustaining-device",
      ruleId: "R-A02",
      message: "Power for a medical device requested. Confirm the person is not in medical distress and has backup (e.g. oxygen tanks). If the device is life-sustaining and failing, escalate to EMS.",
      requiresAcknowledgement: true,
    });
  }
  return advisories;
}
