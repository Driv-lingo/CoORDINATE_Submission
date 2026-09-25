import { ASSISTANCE_DIRECTORY, getService } from "@/data/assistanceDirectory";
import type { AssistanceService, ServiceType } from "@/domain/assistance";
import { HAZARD_LABELS, NEED_RESIDENT_LABELS, VULNERABILITY_LABELS } from "@/domain/catalog";
import type {
  Assessment,
  EscalationTarget,
  GeoPoint,
  HazardClearance,
  IntakeRequest,
  Mission,
  Need,
  NeedEvidence,
  NeedStatus,
  NeedType,
  NeedUrgency,
  ResolutionPath,
  TriageResult,
  Vulnerability,
} from "@/domain/types";
import { pointInPolygon } from "./geometry";
import { HAZARD_RULES } from "./rules";
import { scanCrisis, scanHomebound, scanNeedEvidence } from "./textScan";

/**
 * The Disaster Assistance Navigator.
 *
 *   incident → needs → resolution path → (guidance | trusted service | human
 *   handoff | professional response | community mission | resource transfer)
 *
 * Deterministic and pure. The AI proposes needs and quotes the words that
 * support them; these rules decide what happens to each need. Only needs on
 * the COMMUNITY_MISSION and RESOURCE_TRANSFER paths can ever reach the
 * capability engine — and only after the resident asks for coordinated help.
 */

/* ------------------------------------------------------------------ */
/* Rule book (rendered on "How it works")                              */
/* ------------------------------------------------------------------ */

export interface NavigatorRule {
  id: string;
  title: string;
  description: string;
}

export const NAVIGATOR_RULES: NavigatorRule[] = [
  { id: "N-01", title: "Life safety first", description: "Immediate danger, a medical emergency, swift water, fire or violence creates an Emergency-response need on the PROFESSIONAL_RESPONSE path. The resident is told to call 911; a coordinator gets a handoff summary. CoORDINATE never contacts 911 itself." },
  { id: "N-02", title: "Hazards belong to professionals", description: "A downed power line, gas leak, damaged structure or hazardous materials creates a Hazard-response need routed to the utility, fire service, building official or emergency management — never to volunteers." },
  { id: "N-03", title: "No community mission while a hazard is active", description: "Every community or resource need at a site with an uncleared hazard is BLOCKED_BY_HAZARD. It becomes available again only after a coordinator records that the responsible authority cleared the hazard (R-C01)." },
  { id: "N-04", title: "Hands-on work is a community mission", description: "Tree and debris clearing, water removal, tear-out, moving belongings, roof tarps, wellness checks, rides and medication pickup can be done by qualified community volunteers — if the resident asks." },
  { id: "N-05", title: "Supplies: referral first, delivery when homebound", description: "Food, water and phone charging go to a distribution point (SERVICE_REFERRAL) unless the household cannot travel — limited mobility, medical dependency, an older adult, a blocked or washed-out road — in which case a delivery is a community mission." },
  { id: "N-06", title: "Equipment is a resource transfer", description: "Power for a medical device, medication refrigeration and generator hookups move a physical resource to where it is needed (RESOURCE_TRANSFER) as a logistics mission." },
  { id: "N-07", title: "Shelter is a referral — or a person when access needs exist", description: "Shelter needs point to open shelters and 2-1-1. If someone has mobility, medical or disability needs, a shelter coordinator is asked to confirm an accessible placement (HUMAN_ESCALATION)." },
  { id: "N-08", title: "Outages go to the utility", description: "Power outages are reported to the utility (SERVICE_REFERRAL) with generator and carbon-monoxide safety guidance." },
  { id: "N-09", title: "Financial assistance follows declarations", description: "Programs that require a federal declaration are shown with that condition. Without a declaration the need is INFORMATION (document damage, contact your insurer); with one it is a SERVICE_REFERRAL." },
  { id: "N-10", title: "Complex recovery needs a caseworker", description: "Loss of a home or 'I don't know where to start' is handed to a disaster caseworker (HUMAN_ESCALATION)." },
  { id: "N-11", title: "Emotional support — and crisis goes to people", description: "Distress is referred to the Disaster Distress Helpline. Words suggesting self-harm put 988 first and ask a coordinator to call back; never a volunteer mission." },
  { id: "N-12", title: "Road reports feed the operational picture", description: "An information-only road report is SITUATIONAL_AWARENESS: it joins the common operational picture and can restrict routes once corroborated (rules A1–A4)." },
  { id: "N-13", title: "Nobody is left without a path", description: "If no need can be identified, a community coordinator is asked to follow up and 2-1-1 is offered." },
  { id: "N-14", title: "Suggested needs are offered, never assumed", description: "The rules may suggest related needs (flooding + limited mobility → accessible transportation and shelter). Suggestions are shown as options and are never requested on the resident's behalf." },
  { id: "N-15", title: "The resident decides", description: "Community help is offered, not imposed: nothing reaches the capability engine until the resident (or a coordinator on their behalf) requests coordinated help for specific needs." },
];

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

export interface NavigatorContext {
  /** Show exercise-only activations (open shelters, distribution points). Never in a live workspace. */
  includeExerciseServices: boolean;
  /** Declaration status used for eligibility. "unknown" in live mode: the resident is told to check. */
  declarations: { federal: boolean | "unknown"; stateActivation: boolean | "unknown" };
  /** Label for the declaration status, e.g. "exercise status". */
  declarationSource: string;
}

/** The fictional TS Delphine exercise: state of emergency, no federal declaration yet. */
export const EXERCISE_CONTEXT: NavigatorContext = {
  includeExerciseServices: true,
  declarations: { federal: false, stateActivation: false },
  declarationSource: "TS Delphine exercise status",
};

export const LIVE_CONTEXT: NavigatorContext = {
  includeExerciseServices: false,
  declarations: { federal: "unknown", stateActivation: "unknown" },
  declarationSource: "not tracked by CoORDINATE",
};

/* ------------------------------------------------------------------ */
/* Path selection                                                       */
/* ------------------------------------------------------------------ */

export const MISSION_PATHS: ResolutionPath[] = ["COMMUNITY_MISSION", "RESOURCE_TRANSFER"];
const ESCALATION_PATHS: ResolutionPath[] = ["PROFESSIONAL_RESPONSE", "HUMAN_ESCALATION"];

/** Needs the navigator derives itself; the AI may not propose them. */
export const DERIVED_ONLY_NEEDS: NeedType[] = ["EMERGENCY_RESPONSE", "HAZARD_RESPONSE", "ROAD_CONDITION", "GENERAL_GUIDANCE"];

const HANDS_ON: NeedType[] = ["TREE_CUTTING", "DEBRIS_REMOVAL", "ACCESS_BLOCKED", "WATER_MITIGATION", "MUCK_OUT", "MOVE_BELONGINGS", "ROOF_TARP", "WELLNESS_CHECK", "TRANSPORTATION", "MEDICATION", "SHELTER_STAFFING"];
const EQUIPMENT: NeedType[] = ["POWER_MEDICAL_DEVICE", "REFRIGERATION", "GENERATOR_POWER"];
const ACCESS_FUNCTIONAL: Vulnerability[] = ["MOBILITY_LIMITED", "MEDICAL_DEPENDENCY", "DISABILITY_OTHER"];
const HOMEBOUND_VULNERABILITIES: Vulnerability[] = ["MOBILITY_LIMITED", "MEDICAL_DEPENDENCY", "DISABILITY_OTHER", "OLDER_ADULT"];
const LIFE_SAFETY_TARGETS: EscalationTarget[] = ["EMS_911", "FIRE_RESCUE_911", "LAW_ENFORCEMENT_911", "SWIFT_WATER_RESCUE_911"];

interface Facts {
  vulnerabilities: Vulnerability[];
  homebound?: string;
  crisis?: string;
  context: NavigatorContext;
}

interface PathChoice {
  path: ResolutionPath;
  ruleId: string;
  reason: string;
  urgency: NeedUrgency;
  escalateTo: EscalationTarget[];
}

const URGENCY: Partial<Record<NeedType, NeedUrgency>> = {
  EMERGENCY_RESPONSE: "IMMEDIATE",
  HAZARD_RESPONSE: "IMMEDIATE",
  POWER_MEDICAL_DEVICE: "IMMEDIATE",
  MUCK_OUT: "SOON",
  DEBRIS_REMOVAL: "SOON",
  MOVE_BELONGINGS: "TODAY",
  SHELTER_STAFFING: "TODAY",
  DISASTER_ASSISTANCE: "RECOVERY",
  RECOVERY_CASEWORK: "RECOVERY",
  EMOTIONAL_SUPPORT: "SOON",
  ROAD_CONDITION: "TODAY",
  GENERAL_GUIDANCE: "TODAY",
};

function choosePath(type: NeedType, f: Facts): PathChoice {
  const urgency = URGENCY[type] ?? "TODAY";
  const access = f.vulnerabilities.filter((v) => ACCESS_FUNCTIONAL.includes(v));
  const homebound = f.homebound ? `“${f.homebound}”` : f.vulnerabilities.filter((v) => HOMEBOUND_VULNERABILITIES.includes(v)).map((v) => VULNERABILITY_LABELS[v].toLowerCase())[0];
  switch (type) {
    case "EMERGENCY_RESPONSE":
      return { path: "PROFESSIONAL_RESPONSE", ruleId: "N-01", reason: "Someone may be in immediate danger — this needs emergency services, not volunteers.", urgency, escalateTo: [] };
    case "HAZARD_RESPONSE":
      return { path: "PROFESSIONAL_RESPONSE", ruleId: "N-02", reason: "Only trained professionals may make this hazard safe.", urgency, escalateTo: [] };
    case "FOOD":
    case "WATER":
      return homebound
        ? { path: "COMMUNITY_MISSION", ruleId: "N-05", reason: `The household cannot easily travel (${homebound}), so a delivery is appropriate.`, urgency, escalateTo: [] }
        : { path: "SERVICE_REFERRAL", ruleId: "N-05", reason: "A distribution point can meet this need today.", urgency, escalateTo: [] };
    case "DEVICE_CHARGING":
      return homebound
        ? { path: "RESOURCE_TRANSFER", ruleId: "N-05", reason: `The household cannot easily travel (${homebound}); a battery station can be brought to them.`, urgency, escalateTo: [] }
        : { path: "SERVICE_REFERRAL", ruleId: "N-05", reason: "Charging is available at open resource points and shelters.", urgency, escalateTo: [] };
    case "SHELTER":
      return access.length
        ? { path: "HUMAN_ESCALATION", ruleId: "N-07", reason: `A shelter coordinator should confirm an accessible placement (${access.map((v) => VULNERABILITY_LABELS[v].toLowerCase()).join(", ")}).`, urgency, escalateTo: ["SHELTER_COORDINATOR"] }
        : { path: "SERVICE_REFERRAL", ruleId: "N-07", reason: "Open shelters and 2-1-1 can place the household.", urgency, escalateTo: [] };
    case "UTILITY_OUTAGE":
      return { path: "SERVICE_REFERRAL", ruleId: "N-08", reason: "Outages are restored by the utility; report it to them.", urgency, escalateTo: [] };
    case "DISASTER_ASSISTANCE":
      return f.context.declarations.federal === false
        ? { path: "INFORMATION", ruleId: "N-09", reason: `No federal declaration covers this area yet (${f.context.declarationSource}); document damage now so you can apply if one is made.`, urgency, escalateTo: [] }
        : { path: "SERVICE_REFERRAL", ruleId: "N-09", reason: f.context.declarations.federal === true ? "A federal declaration covers this area; apply directly." : "Check whether a federal declaration covers your county, then apply directly.", urgency, escalateTo: [] };
    case "RECOVERY_CASEWORK":
      return { path: "HUMAN_ESCALATION", ruleId: "N-10", reason: "Recovery planning needs a person: a disaster caseworker.", urgency, escalateTo: ["HUMAN_CASEWORKER"] };
    case "EMOTIONAL_SUPPORT":
      return f.crisis
        ? { path: "HUMAN_ESCALATION", ruleId: "N-11", reason: "The words used suggest a possible crisis: 988 first, and a coordinator should call back.", urgency: "IMMEDIATE", escalateTo: ["COMMUNITY_COORDINATOR"] }
        : { path: "SERVICE_REFERRAL", ruleId: "N-11", reason: "Trained counselors are available any time.", urgency, escalateTo: [] };
    case "ROAD_CONDITION":
      return { path: "SITUATIONAL_AWARENESS", ruleId: "N-12", reason: "The report joins the operational picture; corroborated conditions can restrict routes.", urgency, escalateTo: [] };
    case "GENERAL_GUIDANCE":
      return { path: "HUMAN_ESCALATION", ruleId: "N-13", reason: "We could not identify a specific need, so a person will follow up.", urgency, escalateTo: ["COMMUNITY_COORDINATOR"] };
    default:
      if (EQUIPMENT.includes(type)) return { path: "RESOURCE_TRANSFER", ruleId: "N-06", reason: "A physical resource needs to be delivered and set up.", urgency, escalateTo: [] };
      if (HANDS_ON.includes(type)) return { path: "COMMUNITY_MISSION", ruleId: "N-04", reason: "Qualified community volunteers can do this safely.", urgency, escalateTo: [] };
      return { path: "HUMAN_ESCALATION", ruleId: "N-13", reason: "A person will follow up.", urgency, escalateTo: ["COMMUNITY_COORDINATOR"] };
  }
}

/* ------------------------------------------------------------------ */
/* Guidance                                                             */
/* ------------------------------------------------------------------ */

const GUIDANCE: Partial<Record<NeedType, string[]>> = {
  EMERGENCY_RESPONSE: ["Call 911 now if anyone is hurt, trapped or in danger. Do not wait for a callback."],
  TREE_CUTTING: ["Don't cut storm-damaged trees yourself — trunks under tension can spring back.", "Stay clear of any tree touching a wire."],
  ACCESS_BLOCKED: ["If you must leave urgently and cannot get out, call 911."],
  WATER_MITIGATION: ["Stay out of standing water that could reach outlets, cords, appliances or the electrical panel.", "Photograph the water and damage before cleanup, for insurance or assistance."],
  MUCK_OUT: ["Wear gloves, boots and a mask around floodwater and mold.", "Photograph damage before anything is removed."],
  ROOF_TARP: ["Don't climb onto a wet or damaged roof.", "Move people and valuables away from the leak."],
  FOOD: ["Throw away food that touched floodwater or was in a fridge without power for more than 4 hours."],
  WATER: ["If you are unsure your tap water is safe, use bottled water until officials say otherwise."],
  MEDICATION: ["Call your pharmacy or doctor — ask about an emergency refill or transfer."],
  POWER_MEDICAL_DEVICE: ["If a life-sustaining device stops working, call 911.", "Keep backup oxygen or batteries close and check how long they will last."],
  REFRIGERATION: ["Keep insulin as cool as you can; ask your pharmacist how long it stays usable at room temperature."],
  TRANSPORTATION: ["Pack medications, mobility aids, chargers and documents before the ride arrives."],
  SHELTER: ["Bring medications, IDs, phone chargers and any mobility or medical equipment.", "Tell the shelter about any access or medical needs when you arrive."],
  WELLNESS_CHECK: ["If you believe the person is in immediate danger, call 911 instead of waiting."],
  UTILITY_OUTAGE: ["Never run a generator, grill or camp stove indoors or in a garage — carbon monoxide can kill.", "Stay at least 35 feet from any downed wire and report it."],
  DISASTER_ASSISTANCE: ["Photograph all damage and keep receipts for repairs and temporary lodging.", "Contact your insurance company first."],
  RECOVERY_CASEWORK: ["Keep a folder with IDs, insurance papers, photos and receipts."],
  EMOTIONAL_SUPPORT: ["Feeling overwhelmed after a disaster is common. Talking to someone helps."],
  ROAD_CONDITION: ["Turn around, don't drown — never drive through water over the road."],
  GENERAL_GUIDANCE: ["A person from the community coordination team will follow up. If anyone is in danger, call 911."],
};

function guidanceFor(type: NeedType, f: Facts, hazardGuidance: string[]): string[] {
  if (type === "HAZARD_RESPONSE") return hazardGuidance;
  if (type === "EMOTIONAL_SUPPORT" && f.crisis) return ["If you might act on thoughts of harming yourself, call or text 988 now, or call 911."];
  return GUIDANCE[type] ?? [];
}

/* ------------------------------------------------------------------ */
/* Trusted service recommendations                                      */
/* ------------------------------------------------------------------ */

const SERVICE_TYPES_FOR: Partial<Record<NeedType, ServiceType[]>> = {
  EMERGENCY_RESPONSE: ["EMERGENCY_SERVICES"],
  HAZARD_RESPONSE: ["EMERGENCY_SERVICES"],
  SHELTER: ["SHELTER", "INFORMATION_REFERRAL"],
  FOOD: ["FOOD"],
  WATER: ["WATER", "FOOD"],
  DEVICE_CHARGING: ["CHARGING"],
  TRANSPORTATION: ["TRANSPORTATION"],
  UTILITY_OUTAGE: ["UTILITY_OUTAGE"],
  DISASTER_ASSISTANCE: ["DISASTER_ASSISTANCE", "RECOVERY_LOANS"],
  RECOVERY_CASEWORK: ["CASE_MANAGEMENT", "INFORMATION_REFERRAL"],
  EMOTIONAL_SUPPORT: ["CRISIS_COUNSELING"],
  ROAD_CONDITION: ["ROAD_CONDITIONS"],
  GENERAL_GUIDANCE: ["INFORMATION_REFERRAL", "EMERGENCY_MANAGEMENT"],
};

function serves(service: AssistanceService, p: GeoPoint): boolean {
  return service.geography.type === "Polygon" && pointInPolygon([p.lng, p.lat], service.geography.coordinates);
}

/** Eligibility conditions not met right now, in plain language. */
export function servicePending(service: AssistanceService, ctx: NavigatorContext): string[] {
  const out: string[] = [];
  for (const rule of service.eligibility ?? []) {
    const state = rule.requires === "FEDERAL_DECLARATION" ? ctx.declarations.federal : rule.requires === "STATE_ACTIVATION" ? ctx.declarations.stateActivation : true;
    if (state === false) out.push(`${rule.description} Not in effect yet (${ctx.declarationSource}).`);
    else if (state === "unknown") out.push(`${rule.description} Check whether it applies to you.`);
  }
  return out;
}

/** Recommended trusted services for one need — ranked, with provenance, limited to the area served. */
export function recommendServices(type: NeedType, point: GeoPoint, f: Facts, extra: { powerLine?: boolean } = {}): string[] {
  const wanted = [...(SERVICE_TYPES_FOR[type] ?? [])];
  if (type === "HAZARD_RESPONSE" && extra.powerLine) wanted.push("UTILITY_OUTAGE");
  if (!wanted.length) return [];
  const accessible = f.vulnerabilities.some((v) => ACCESS_FUNCTIONAL.includes(v));
  const rank = (s: AssistanceService) => {
    let r = Math.min(...s.serviceTypes.map((t) => (wanted.indexOf(t) < 0 ? 99 : wanted.indexOf(t)))) * 10;
    if (s.simulated) r -= 3; // an open local activation beats a generic line
    if (accessible && s.accessible) r -= 2;
    if (type === "EMOTIONAL_SUPPORT") r += f.crisis ? (s.id === "svc-988" ? -20 : 0) : s.id === "svc-988" ? 5 : 0;
    return r;
  };
  return ASSISTANCE_DIRECTORY.filter((s) => (f.context.includeExerciseServices || !s.simulated) && s.serviceTypes.some((t) => wanted.includes(t)) && serves(s, point))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((s) => s.id);
}

/* ------------------------------------------------------------------ */
/* Decomposition                                                        */
/* ------------------------------------------------------------------ */

export interface DecomposeInput {
  incidentId: string;
  assessment: Assessment;
  triage: TriageResult;
  request: IntakeRequest;
  location: GeoPoint;
  clearances: HazardClearance[];
  /** Phrases the AI quoted for each need (already checked against the text by the validator). */
  aiEvidence?: Partial<Record<NeedType, string>>;
  context: NavigatorContext;
  now: Date;
}

const PATH_ORDER: ResolutionPath[] = ["PROFESSIONAL_RESPONSE", "HUMAN_ESCALATION", "COMMUNITY_MISSION", "RESOURCE_TRANSFER", "SERVICE_REFERRAL", "INFORMATION", "SITUATIONAL_AWARENESS"];
const URGENCY_ORDER: NeedUrgency[] = ["IMMEDIATE", "TODAY", "SOON", "RECOVERY"];

/**
 * Decompose an incident into needs, each with a resolution path. Pure: the same
 * incident always produces the same needs.
 */
export function decomposeNeeds(input: DecomposeInput): Need[] {
  const { assessment, triage, request } = input;
  const text = request.text;
  const at = input.now.toISOString();
  const cleared = new Set(input.clearances.map((c) => c.hazard));
  const activeHazards = assessment.hazards.filter((h) => !cleared.has(h));
  const facts: Facts = { vulnerabilities: assessment.vulnerabilities, homebound: scanHomebound(text), crisis: scanCrisis(text), context: input.context };
  if (!facts.homebound && assessment.needs.includes("ACCESS_BLOCKED")) facts.homebound = "can't get out";

  const scanned = scanNeedEvidence(text);
  const evidenceFor = (type: NeedType): NeedEvidence[] => {
    const ev: NeedEvidence[] = [];
    const ai = input.aiEvidence?.[type];
    if (ai) ev.push({ phrase: ai, by: "AI" });
    const sc = scanned[type];
    if (sc && !ev.some((e) => e.phrase.toLowerCase() === sc.toLowerCase())) ev.push({ phrase: sc, by: "SCANNER" });
    if (request.categoryHint && ev.length === 0) ev.push({ phrase: `Resident chose “${request.categoryHint.replace(/_/g, " ").toLowerCase()}”`, by: "RESIDENT_FORM" });
    return ev;
  };

  const items: { type: NeedType; origin: Need["origin"]; evidence: NeedEvidence[]; escalateTo?: EscalationTarget[]; guidance?: string[] }[] = [];

  // N-01 / N-02: professional needs from triage and hazards.
  const lifeHazards = activeHazards.filter((h) => HAZARD_RULES[h].level === "LIFE_SAFETY_EMERGENCY");
  const proHazards = activeHazards.filter((h) => HAZARD_RULES[h].level === "PROFESSIONAL_RESPONSE_REQUIRED");
  const lifeSafety = request.immediateDanger || assessment.immediateLifeThreat || lifeHazards.length > 0;
  if (lifeSafety) {
    const targets = [...new Set([...lifeHazards.flatMap((h) => HAZARD_RULES[h].escalateTo), ...triage.escalateTo.filter((t) => LIFE_SAFETY_TARGETS.includes(t))])];
    items.push({
      type: "EMERGENCY_RESPONSE",
      origin: "STATED",
      evidence: [
        ...(request.immediateDanger ? [{ phrase: "Resident checked “someone is in immediate danger”", by: "RESIDENT_FORM" as const }] : []),
        ...lifeHazards.map((h) => ({ phrase: HAZARD_LABELS[h], by: "RULES" as const })),
        ...(assessment.immediateLifeThreat && !lifeHazards.length && !request.immediateDanger ? [{ phrase: "Immediate threat to life identified", by: "AI" as const }] : []),
      ],
      escalateTo: targets.length ? targets : ["EMS_911"],
      guidance: [...GUIDANCE.EMERGENCY_RESPONSE!, ...lifeHazards.map((h) => HAZARD_RULES[h].guidance)],
    });
  }
  if (proHazards.length) {
    items.push({
      type: "HAZARD_RESPONSE",
      origin: "STATED",
      evidence: proHazards.map((h) => ({ phrase: HAZARD_LABELS[h], by: "RULES" as const })),
      escalateTo: [...new Set(proHazards.flatMap((h) => HAZARD_RULES[h].escalateTo))],
      guidance: proHazards.map((h) => HAZARD_RULES[h].guidance),
    });
  }

  // Stated needs (validated AI ∪ scanner ∪ resident form), then navigator-only additions.
  const stated = assessment.needs.filter((n) => !DERIVED_ONLY_NEEDS.includes(n));
  for (const type of stated) items.push({ type, origin: "STATED", evidence: evidenceFor(type) });
  if (facts.crisis && !stated.includes("EMOTIONAL_SUPPORT")) items.push({ type: "EMOTIONAL_SUPPORT", origin: "STATED", evidence: [{ phrase: facts.crisis, by: "SCANNER" }] });
  if (assessment.informationOnly) items.push({ type: "ROAD_CONDITION", origin: "STATED", evidence: [{ phrase: "Reported a road or area condition; no help needed", by: "SCANNER" }] });

  // N-14: suggestions (offered, never requested automatically).
  const flooding = stated.includes("WATER_MITIGATION") || stated.includes("MUCK_OUT");
  const mobility = assessment.vulnerabilities.filter((v) => v === "MOBILITY_LIMITED" || v === "OLDER_ADULT" || v === "DISABILITY_OTHER");
  if (flooding && mobility.length && !lifeSafety) {
    const why = `Flooding and ${mobility.map((v) => VULNERABILITY_LABELS[v].toLowerCase()).join(", ")}`;
    if (!stated.includes("TRANSPORTATION")) items.push({ type: "TRANSPORTATION", origin: "SUGGESTED", evidence: [{ phrase: why, by: "RULES" }] });
    if (!stated.includes("SHELTER")) items.push({ type: "SHELTER", origin: "SUGGESTED", evidence: [{ phrase: why, by: "RULES" }] });
  }

  // N-13: nobody is left without a path.
  if (!items.length) items.push({ type: "GENERAL_GUIDANCE", origin: "STATED", evidence: [] });

  const hazardBlocks = !triage.civilianDispatchAllowed && triage.level !== "INFORMATION_ONLY";
  const powerLine = activeHazards.includes("DOWNED_POWER_LINE");
  const needs = items.map((it) => {
    let choice = choosePath(it.type, facts);
    // A suggestion is never escalated on the resident's behalf (N-14): offer the services instead.
    if (it.origin === "SUGGESTED" && ESCALATION_PATHS.includes(choice.path)) {
      choice = { ...choice, path: "SERVICE_REFERRAL", ruleId: "N-14", reason: "If you need this, these services can help — tell them about any access or medical needs.", escalateTo: [] };
    }
    const escalateTo = it.escalateTo ?? choice.escalateTo;
    let status: NeedStatus;
    if (ESCALATION_PATHS.includes(choice.path)) status = it.origin === "SUGGESTED" ? "IDENTIFIED" : "ESCALATION_RECOMMENDED";
    else if (MISSION_PATHS.includes(choice.path)) status = hazardBlocks ? "BLOCKED_BY_HAZARD" : "HELP_AVAILABLE";
    else status = "IDENTIFIED";
    const reason = status === "BLOCKED_BY_HAZARD" ? `${choice.reason} On hold: no community mission while a hazard at this location is active (N-03).` : choice.reason;
    return {
      id: "",
      type: it.type,
      origin: it.origin,
      urgency: choice.urgency,
      path: choice.path,
      status,
      ruleId: status === "BLOCKED_BY_HAZARD" ? "N-03" : choice.ruleId,
      reason,
      evidence: it.evidence,
      guidance: it.guidance ?? guidanceFor(it.type, facts, []),
      serviceIds: recommendServices(it.type, input.location, facts, { powerLine }),
      escalateTo,
      updatedAt: at,
    } satisfies Need;
  });

  return needs
    .map((n, i) => ({ n, i }))
    .sort(
      (a, b) =>
        URGENCY_ORDER.indexOf(a.n.urgency) - URGENCY_ORDER.indexOf(b.n.urgency) ||
        (a.n.origin === b.n.origin ? 0 : a.n.origin === "STATED" ? -1 : 1) ||
        PATH_ORDER.indexOf(a.n.path) - PATH_ORDER.indexOf(b.n.path) ||
        a.i - b.i,
    )
    .map(({ n }, i) => ({ ...n, id: `${input.incidentId}-n${i + 1}` }));
}

/* ------------------------------------------------------------------ */
/* Status changes over the incident's life                              */
/* ------------------------------------------------------------------ */

const PROGRESSED: NeedStatus[] = ["HELP_REQUESTED", "MISSION_ACTIVE", "HANDED_OFF", "RESOLVED", "NOT_REQUESTED"];

/**
 * Re-run decomposition after the incident changed (needs corrected, hazard
 * cleared) and carry over what already happened to each need.
 */
export function refreshNeeds(previous: Need[], fresh: Need[], incidentId: string, now: Date): Need[] {
  const at = now.toISOString();
  const byType = new Map(previous.map((n) => [n.type, n]));
  let next = previous.reduce((m, n) => Math.max(m, parseInt(n.id.split("-n").pop() ?? "0", 10) || 0), 0);
  const out: Need[] = fresh.map((f) => {
    const old = byType.get(f.type);
    if (!old) return { ...f, id: `${incidentId}-n${++next}` };
    const keepStatus = PROGRESSED.includes(old.status) && !(f.status === "BLOCKED_BY_HAZARD" && old.status !== "MISSION_ACTIVE" && old.status !== "RESOLVED");
    // A resident's decision about a suggestion stands; a mission path keeps its mission.
    return {
      ...f,
      id: old.id,
      origin: old.origin === "STATED" ? "STATED" : f.origin,
      evidence: old.evidence.length ? old.evidence : f.evidence,
      status: keepStatus ? old.status : f.status,
      missionId: old.missionId,
      updatedAt: keepStatus && old.status === f.status ? old.updatedAt : at,
    };
  });
  // Needs that no longer apply (e.g. a hazard cleared by the authority) stay on record as resolved.
  for (const old of previous) {
    if (fresh.some((f) => f.type === old.type)) continue;
    out.push({ ...old, status: old.status === "RESOLVED" ? old.status : "RESOLVED", reason: old.type === "HAZARD_RESPONSE" ? "The responsible authority cleared the hazard." : old.reason, updatedAt: old.status === "RESOLVED" ? old.updatedAt : at });
  }
  return out;
}

export function isMissionNeed(n: Need): boolean {
  return MISSION_PATHS.includes(n.path);
}

/**
 * Need types the capability engine should plan for: the ones the resident
 * requested; before any request, the stated community needs (a preview for triage).
 */
export function missionNeedTypes(needs: Need[]): NeedType[] {
  const mission = needs.filter(isMissionNeed);
  const requested = mission.filter((n) => n.status === "HELP_REQUESTED" || n.status === "MISSION_ACTIVE" || (n.status === "RESOLVED" && !!n.missionId));
  if (requested.length) return requested.map((n) => n.type);
  return mission.filter((n) => n.status === "HELP_AVAILABLE" && n.origin === "STATED").map((n) => n.type);
}

export function hasRequestedHelp(needs: Need[]): boolean {
  return needs.some((n) => isMissionNeed(n) && (n.status === "HELP_REQUESTED" || n.status === "MISSION_ACTIVE"));
}

export class NavigatorError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

/** Rule N-15: the resident (or a coordinator for them) asks for coordinated help with specific needs. */
export function requestHelp(needs: Need[], needIds: string[], now: Date): Need[] {
  const at = now.toISOString();
  const wanted = new Set(needIds);
  const picked = needs.filter((n) => wanted.has(n.id));
  if (!picked.length) throw new NavigatorError("Choose at least one need to request help with.", 400);
  for (const n of picked) {
    if (!isMissionNeed(n)) throw new NavigatorError(`“${NEED_RESIDENT_LABELS[n.type]}” is handled through ${n.path === "SERVICE_REFERRAL" ? "a trusted service" : "other help"}, not a community mission.`, 400);
    if (n.status === "BLOCKED_BY_HAZARD") throw new NavigatorError("Community help can't be sent while a hazard at this location is active.");
    if (n.status !== "HELP_AVAILABLE" && n.status !== "NOT_REQUESTED") throw new NavigatorError(`“${NEED_RESIDENT_LABELS[n.type]}” was already requested.`);
  }
  return needs.map((n) => {
    if (wanted.has(n.id)) return { ...n, status: "HELP_REQUESTED", updatedAt: at };
    if (isMissionNeed(n) && n.status === "HELP_AVAILABLE") return { ...n, status: "NOT_REQUESTED", updatedAt: at };
    return n;
  });
}

/** Keep mission-path needs in step with the mission. */
export function syncNeedsWithMission(needs: Need[], mission: Pick<Mission, "id" | "status"> | undefined, now: Date): Need[] {
  const at = now.toISOString();
  return needs.map((n) => {
    if (!isMissionNeed(n)) return n;
    if (!mission || mission.status === "CANCELLED") {
      return n.status === "MISSION_ACTIVE" ? { ...n, status: "HELP_REQUESTED", missionId: undefined, updatedAt: at } : n;
    }
    if (n.status === "HELP_REQUESTED") return { ...n, status: mission.status === "VERIFIED" ? "RESOLVED" : "MISSION_ACTIVE", missionId: mission.id, updatedAt: at };
    if (n.status === "MISSION_ACTIVE" && mission.status === "VERIFIED") return { ...n, status: "RESOLVED", updatedAt: at };
    return n;
  });
}

/** A handoff contact recorded by a coordinator moves the needs it covers to HANDED_OFF. */
export function markHandedOff(needs: Need[], needIds: string[] | undefined, now: Date): Need[] {
  if (!needIds?.length) return needs;
  const at = now.toISOString();
  return needs.map((n) => (needIds.includes(n.id) && n.status === "ESCALATION_RECOMMENDED" ? { ...n, status: "HANDED_OFF", updatedAt: at } : n));
}

/** A coordinator records that a referral or handoff need is taken care of. */
export function resolveNeed(needs: Need[], needId: string, now: Date): Need[] {
  const n = needs.find((x) => x.id === needId);
  if (!n) throw new NavigatorError("Need not found.", 404);
  if (isMissionNeed(n) && (n.status === "HELP_REQUESTED" || n.status === "MISSION_ACTIVE")) throw new NavigatorError("This need is resolved when its mission is verified.");
  return needs.map((x) => (x.id === needId ? { ...x, status: "RESOLVED", updatedAt: now.toISOString() } : x));
}

/* ------------------------------------------------------------------ */
/* Resident-facing summary                                              */
/* ------------------------------------------------------------------ */

/**
 * "Immediate priority" lines shown before anything else. Deterministic text:
 * danger first, then the few actions that prevent the most harm.
 */
export function immediatePriority(needs: Need[], triage: TriageResult): string[] {
  const types = new Set(needs.filter((n) => n.status !== "RESOLVED").map((n) => n.type));
  const lines: string[] = [];
  if (types.has("EMERGENCY_RESPONSE") || types.has("HAZARD_RESPONSE")) {
    lines.push("Call 911 now if anyone is hurt, trapped or in danger.");
    lines.push(...triage.guidance.filter((g) => !/call 911\.?$/i.test(g)).slice(0, 2));
  } else {
    lines.push("First, check whether anyone is in immediate danger. If anyone is hurt or trapped, call 911.");
  }
  if (types.has("WATER_MITIGATION") || types.has("MUCK_OUT")) lines.push("If water is near outlets, cords or the electrical panel, stay out of it — leave the area and call 911 if anyone can't get out.");
  if (types.has("POWER_MEDICAL_DEVICE")) lines.push("If a life-sustaining device stops working, call 911.");
  if (types.has("UTILITY_OUTAGE") && !types.has("HAZARD_RESPONSE")) lines.push("Never run a generator or grill indoors or in a garage.");
  if (types.has("EMOTIONAL_SUPPORT") && needs.some((n) => n.type === "EMOTIONAL_SUPPORT" && n.urgency === "IMMEDIATE")) lines.unshift("If you might hurt yourself, call or text 988 now.");
  return [...new Set(lines)].slice(0, 4);
}

export function describeService(id: string) {
  return getService(id);
}
