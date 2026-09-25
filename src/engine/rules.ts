import type { EscalationTarget, Hazard, TriageLevel, Vulnerability } from "@/domain/types";

/** Vulnerable-occupant rule R-V01: households where every on-site person must be background-checked. */
export const VULNERABLE_OCCUPANT: Vulnerability[] = ["MOBILITY_LIMITED", "OLDER_ADULT", "MEDICAL_DEPENDENCY", "CHILDREN", "DISABILITY_OTHER"];

/**
 * The safety rule book. This table IS the executed logic — the UI's
 * "How it works" page renders it directly, so what judges read is what runs.
 */

export interface HazardRule {
  id: string;
  hazard: Hazard;
  title: string;
  level: Extract<TriageLevel, "LIFE_SAFETY_EMERGENCY" | "PROFESSIONAL_RESPONSE_REQUIRED">;
  escalateTo: EscalationTarget[];
  guidance: string;
}

/** Roles that may never be dispatched to an active hazard, regardless of skill or proximity. */
export const CIVILIAN_PROHIBITED_ROLES = [
  "General volunteers",
  "Trained / CERT volunteers",
  "Skilled professionals not tasked by the responsible authority",
  "Unverified responders",
];

export const HAZARD_RULES: Record<Hazard, HazardRule> = {
  ACTIVE_FIRE: {
    id: "R-H01",
    hazard: "ACTIVE_FIRE",
    title: "Active fire",
    level: "LIFE_SAFETY_EMERGENCY",
    escalateTo: ["FIRE_RESCUE_911"],
    guidance: "Get everyone out and away from the structure. Call 911.",
  },
  VIOLENCE: {
    id: "R-H02",
    hazard: "VIOLENCE",
    title: "Violence or threat of violence",
    level: "LIFE_SAFETY_EMERGENCY",
    escalateTo: ["LAW_ENFORCEMENT_911"],
    guidance: "Move to a safe place and call 911. Volunteers must not respond.",
  },
  GAS_LEAK: {
    id: "R-H03",
    hazard: "GAS_LEAK",
    title: "Suspected gas leak",
    level: "PROFESSIONAL_RESPONSE_REQUIRED",
    escalateTo: ["GAS_UTILITY", "FIRE_RESCUE_911"],
    guidance: "Leave the building now. Do not use switches, phones or flames nearby. Call from a safe distance.",
  },
  DOWNED_POWER_LINE: {
    id: "R-H04",
    hazard: "DOWNED_POWER_LINE",
    title: "Downed electrical line",
    level: "PROFESSIONAL_RESPONSE_REQUIRED",
    escalateTo: ["ELECTRIC_UTILITY", "FIRE_RESCUE_911"],
    guidance: "Assume every downed line is energized. Stay at least 35 feet away, including from water it touches.",
  },
  UNSTABLE_STRUCTURE: {
    id: "R-H05",
    hazard: "UNSTABLE_STRUCTURE",
    title: "Unstable or damaged structure",
    level: "PROFESSIONAL_RESPONSE_REQUIRED",
    escalateTo: ["BUILDING_OFFICIAL", "FIRE_RESCUE_911"],
    guidance: "Do not enter. A building official must assess before anyone goes inside.",
  },
  HAZARDOUS_MATERIALS: {
    id: "R-H06",
    hazard: "HAZARDOUS_MATERIALS",
    title: "Hazardous materials",
    level: "PROFESSIONAL_RESPONSE_REQUIRED",
    escalateTo: ["HAZMAT_EMERGENCY_MANAGEMENT", "FIRE_RESCUE_911"],
    guidance: "Keep people and pets away and upwind. Do not touch or move containers.",
  },
  SWIFT_WATER: {
    id: "R-H07",
    hazard: "SWIFT_WATER",
    title: "Swift or flood water rescue",
    level: "LIFE_SAFETY_EMERGENCY",
    escalateTo: ["SWIFT_WATER_RESCUE_911"],
    guidance: "Turn around, don't drown. Only trained swift-water teams may attempt a rescue.",
  },
  MEDICAL_EMERGENCY: {
    id: "R-H08",
    hazard: "MEDICAL_EMERGENCY",
    title: "Medical emergency",
    level: "LIFE_SAFETY_EMERGENCY",
    escalateTo: ["EMS_911"],
    guidance: "Call 911. Stay with the person if it is safe to do so.",
  },
};

export interface PolicyRule {
  id: string;
  title: string;
  description: string;
}

/** Non-hazard policy rules, listed for transparency. Implemented in triage.ts / requirements.ts / matching.ts / dispatch.ts. */
export const POLICY_RULES: PolicyRule[] = [
  {
    id: "R-L01",
    title: "Resident reports immediate danger",
    description: "If the requester checks “someone is in immediate danger”, the incident is an emergency escalation. The resident is told to call 911 and professional escalation is recommended to the coordinator — CoORDINATE never contacts 911 itself.",
  },
  {
    id: "R-L02",
    title: "AI may escalate, never de-escalate",
    description: "If the AI flags an immediate life threat or a hazard, it is added. Hazards found by the deterministic keyword scanner or reported by the resident cannot be removed by the AI.",
  },
  {
    id: "R-A01",
    title: "Negated hazard mention requires review",
    description: "Text such as “no power lines down” creates an advisory. A coordinator must acknowledge it before any team is dispatched.",
  },
  {
    id: "R-A02",
    title: "Life-sustaining equipment advisory",
    description: "Requests involving power for oxygen, ventilators or similar devices are raised to P1, and the coordinator must confirm the person has no immediate medical emergency.",
  },
  {
    id: "R-A04",
    title: "Possible duplicate",
    description: "A new request within 150 m and 12 hours of an open incident with the same need raises an advisory. Nothing is merged automatically; a coordinator checks before a second team is sent.",
  },
  {
    id: "R-C01",
    title: "Hazard clearance by an authority",
    description: "A hazard stops blocking dispatch only after a coordinator records that the responsible authority (e.g. the utility) cleared it. The keyword scanner still reports it; the clearance is logged.",
  },
  {
    id: "R-V01",
    title: "Vulnerable-occupant rule",
    description: "When the household includes an older adult, a person with limited mobility, medical dependency or children, every person going on-site must hold a verified background check.",
  },
  {
    id: "R-T01",
    title: "Credential sets the tier",
    description: "If any role requires a verified external credential (e.g. chainsaw safety, roof fall protection, wheelchair securement), the incident is TRAINED_VOLUNTEER_ELIGIBLE; otherwise GENERAL_VOLUNTEER_ELIGIBLE.",
  },
  {
    id: "R-T02",
    title: "Licensed trades",
    description: "If a role requires a state license (e.g. a licensed electrician to connect a generator to a building), the incident is SPECIALIZED_VOLUNTEER_ELIGIBLE and only verified license holders can fill it.",
  },
  {
    id: "R-I01",
    title: "Information-only reports",
    description: "A resident who reports a road or area condition and says no help is needed creates an unverified community report, not a mission. Only the keyword scanner or the resident can make this call — never the AI alone — and any hazard still escalates.",
  },
  {
    id: "R-M01",
    title: "Hard gates before scoring",
    description: "Identity, availability, capacity, skill, credentials, training, equipment and travel range are pass/fail gates. Only candidates that pass every gate are scored. Proximity can never compensate for a failed gate.",
  },
  {
    id: "R-D01",
    title: "Dispatch re-validation",
    description: "At dispatch, triage is re-run, every assignment is re-checked against current credentials, availability and deployments, a route must exist that avoids known closures, and no weather or safety hold may cover the site. Any failure blocks dispatch.",
  },
  {
    id: "R-D02",
    title: "Human dispatch authority",
    description: "Only an authorized coordinator can dispatch or verify a mission. The engine proposes; people decide.",
  },
];
