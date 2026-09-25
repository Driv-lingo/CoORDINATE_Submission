import type { DecisionRecord, MissionHold, RoutePlan } from "./ops";

/**
 * CoORDINATE domain model.
 *
 * Everything that crosses a boundary (API, persistence, AI adapter) is typed
 * here. Enumerations are declared as `const` arrays so the same list drives
 * TypeScript types, zod validation of AI output, and UI pickers.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export const INCIDENT_CATEGORIES = [
  "DEBRIS_CLEARANCE",
  "FLOOD_ASSISTANCE",
  "ROOF_DAMAGE",
  "SUPPLY_DELIVERY",
  "POWER_NEEDS",
  "TRANSPORTATION",
  "WELLNESS_CHECK",
  "SHELTER",
  "ROAD_CONDITION_REPORT",
  "OTHER",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/** Hazards that can never produce a civilian mission while active. */
export const HAZARDS = [
  "ACTIVE_FIRE",
  "VIOLENCE",
  "GAS_LEAK",
  "DOWNED_POWER_LINE",
  "UNSTABLE_STRUCTURE",
  "HAZARDOUS_MATERIALS",
  "SWIFT_WATER",
  "MEDICAL_EMERGENCY",
] as const;
export type Hazard = (typeof HAZARDS)[number];

export const VULNERABILITIES = [
  "MOBILITY_LIMITED",
  "MEDICAL_DEPENDENCY",
  "OLDER_ADULT",
  "CHILDREN",
  "ISOLATED",
  "LANGUAGE_ACCESS",
  "DISABILITY_OTHER",
] as const;
export type Vulnerability = (typeof VULNERABILITIES)[number];

export const NEEDS = [
  "TREE_CUTTING",
  "DEBRIS_REMOVAL",
  "ACCESS_BLOCKED",
  "WATER_MITIGATION",
  "MUCK_OUT",
  "MOVE_BELONGINGS",
  "ROOF_TARP",
  "FOOD",
  "WATER",
  "MEDICATION",
  "POWER_MEDICAL_DEVICE",
  "DEVICE_CHARGING",
  "REFRIGERATION",
  "TRANSPORTATION",
  "SHELTER",
  "WELLNESS_CHECK",
  "GENERATOR_POWER",
  "SHELTER_STAFFING",
  // Navigator needs: resolved by guidance, referral or escalation — never by a volunteer mission.
  "EMERGENCY_RESPONSE",
  "HAZARD_RESPONSE",
  "UTILITY_OUTAGE",
  "DISASTER_ASSISTANCE",
  "RECOVERY_CASEWORK",
  "EMOTIONAL_SUPPORT",
  "ROAD_CONDITION",
  "GENERAL_GUIDANCE",
] as const;
/** What kind of help a person needs. */
export type NeedType = (typeof NEEDS)[number];

/**
 * How a need gets resolved. Not every need becomes a volunteer mission:
 * the navigator picks the path with deterministic rules (engine/navigator.ts).
 */
export const RESOLUTION_PATHS = [
  "PROFESSIONAL_RESPONSE",
  "HUMAN_ESCALATION",
  "COMMUNITY_MISSION",
  "RESOURCE_TRANSFER",
  "SERVICE_REFERRAL",
  "INFORMATION",
  "SITUATIONAL_AWARENESS",
] as const;
export type ResolutionPath = (typeof RESOLUTION_PATHS)[number];

export const NEED_STATUSES = [
  /** Path chosen; the resident has the guidance and options. */
  "IDENTIFIED",
  /** Community help is possible; the resident has not asked for it (yet). */
  "HELP_AVAILABLE",
  /** Resident (or a coordinator on their behalf) asked for coordinated help. */
  "HELP_REQUESTED",
  /** A community mission / delivery is being formed or is under way. */
  "MISSION_ACTIVE",
  /** Community help cannot be sent while a hazard at the site is active. */
  "BLOCKED_BY_HAZARD",
  /** A person or agency should take this over; recommendation recorded, contact not yet made. */
  "ESCALATION_RECOMMENDED",
  /** A coordinator recorded making contact / handing off. */
  "HANDED_OFF",
  "RESOLVED",
  /** The resident chose not to request help for this need. */
  "NOT_REQUESTED",
] as const;
export type NeedStatus = (typeof NEED_STATUSES)[number];

export type NeedUrgency = "IMMEDIATE" | "TODAY" | "SOON" | "RECOVERY";

/** Where a need came from — so the resident and coordinator can see what was said versus inferred. */
export type NeedOrigin = "STATED" | "SUGGESTED";

export const SKILLS = [
  "GENERAL_LABOR",
  "CHAINSAW_OPERATION",
  "ROOF_TARPING",
  "FLOOD_CLEANUP",
  "DRIVING",
  "ACCESSIBLE_TRANSPORT",
  "FIRST_AID",
  "WELLNESS_VISITS",
  "ELECTRICAL",
  "FOOD_SERVICE",
  "SHELTER_OPERATIONS",
] as const;
export type Skill = (typeof SKILLS)[number];

/** Externally issued credentials. CoORDINATE records and verifies them; it never issues them. */
export const CREDENTIAL_TYPES = [
  "BACKGROUND_CHECK",
  "DRIVERS_LICENSE",
  "CHAINSAW_SAFETY",
  "ROOF_FALL_PROTECTION",
  "CERT_BASIC",
  "FIRST_AID_CPR",
  "WHEELCHAIR_SECUREMENT",
  "LICENSED_ELECTRICIAN",
  "FOOD_HANDLER",
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_STATUSES = ["VERIFIED", "PENDING", "EXPIRED", "REVOKED"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

/** Internal CoORDINATE training modules. Completion earns a badge, never a certification. */
export const TRAINING_MODULES = [
  "ORIENTATION",
  "FLOOD_CLEANUP_SAFETY",
  "GENERATOR_CO_SAFETY",
  "PSYCH_FIRST_AID_INTRO",
  "ACCESSIBLE_EVAC_BASICS",
  "CHAINSAW_AWARENESS",
] as const;
export type TrainingModuleId = (typeof TRAINING_MODULES)[number];

export const ASSET_TYPES = [
  "PICKUP_TRUCK",
  "TRAILER",
  "CHAINSAW",
  "GENERATOR",
  "PORTABLE_BATTERY",
  "ACCESSIBLE_VAN",
  "PASSENGER_VEHICLE",
  "FOOD_SUPPLY",
  "WATER_SUPPLY",
  "SHELTER_BEDS",
  "REFRIGERATION",
  "HAND_TOOLS",
  "TARPS",
  "WATER_PUMP",
  "WET_VAC",
  "LADDER",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ROLES = [
  "RESIDENT",
  "GENERAL_VOLUNTEER",
  "TRAINED_VOLUNTEER",
  "SKILLED_PROFESSIONAL",
  "NONPROFIT",
  "BUSINESS",
  "COORDINATOR",
] as const;
export type Role = (typeof ROLES)[number];

export const ACCESSIBILITY_SUPPORT = [
  "WHEELCHAIR_TRANSPORT",
  "MOBILITY_ASSIST",
  "ASL",
  "SENSORY_FRIENDLY",
] as const;
export type AccessibilitySupport = (typeof ACCESSIBILITY_SUPPORT)[number];

/** Response classes, most to least restrictive. */
export const TRIAGE_LEVELS = [
  "LIFE_SAFETY_EMERGENCY",
  "PROFESSIONAL_RESPONSE_REQUIRED",
  "SPECIALIZED_VOLUNTEER_ELIGIBLE",
  "TRAINED_VOLUNTEER_ELIGIBLE",
  "GENERAL_VOLUNTEER_ELIGIBLE",
  "INFORMATION_ONLY",
] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];

export const ESCALATION_TARGETS = [
  "EMS_911",
  "FIRE_RESCUE_911",
  "LAW_ENFORCEMENT_911",
  "SWIFT_WATER_RESCUE_911",
  "ELECTRIC_UTILITY",
  "GAS_UTILITY",
  "BUILDING_OFFICIAL",
  "HAZMAT_EMERGENCY_MANAGEMENT",
  "HUMAN_CASEWORKER",
  "NONPROFIT_PARTNER",
  "SHELTER_COORDINATOR",
  "COMMUNITY_COORDINATOR",
] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

/** Escalation destination classes. Not every escalation is 911. */
export const ESCALATION_DESTINATIONS = [
  "EMERGENCY_SERVICES",
  "PROFESSIONAL_RESPONDER",
  "EMERGENCY_MANAGEMENT",
  "HUMAN_CASEWORKER",
  "NONPROFIT_PARTNER",
  "UTILITY_PROVIDER",
  "SHELTER_COORDINATOR",
  "COMMUNITY_COORDINATOR",
] as const;
export type EscalationDestination = (typeof ESCALATION_DESTINATIONS)[number];

export type PriorityLevel = "P1" | "P2" | "P3" | "P4";

/* ------------------------------------------------------------------ */
/* People, organizations and assets                                    */
/* ------------------------------------------------------------------ */

export interface Credential {
  type: CredentialType;
  status: CredentialStatus;
  /** Who issued the credential (external body). */
  issuer: string;
  reference?: string;
  verifiedAt?: string;
  /** Who verified the record inside CoORDINATE (e.g. coordinator, partner registry). */
  verifiedBy?: string;
  expiresAt?: string;
}

export interface TrainingRecord {
  moduleId: TrainingModuleId;
  completedAt: string;
}

export interface Asset {
  id: string;
  type: AssetType;
  label: string;
  /** Units available in total (e.g. 2 generators, 40 shelter beds, 300 meals). */
  quantity: number;
  /** Consumable assets are drawn down when a mission is verified complete. */
  consumable?: boolean;
  /** Asset is wheelchair accessible (vans, shelters). */
  accessible?: boolean;
}

export type AvailabilityStatus = "AVAILABLE" | "LIMITED" | "UNAVAILABLE";

export interface Responder {
  id: string;
  workspaceId: string;
  kind: "PERSON" | "ORGANIZATION";
  role: Role;
  name: string;
  /** Organization type / tagline, or a person's short description. */
  headline: string;
  locality: string;
  location: GeoPoint;
  maxTravelKm: number;
  /** Person identity (or organization legitimacy) verified by a coordinator/partner. */
  identityVerified: boolean;
  skills: Skill[];
  credentials: Credential[];
  training: TrainingRecord[];
  assets: Asset[];
  languages: string[];
  accessibilitySupport: AccessibilitySupport[];
  availability: { status: AvailabilityStatus; note?: string };
  stats: { missionsCompleted: number; hoursContributed: number };
  /** Live operation: the browser that registered this profile (simulated sign-in; never sent to clients). */
  ownerKey?: string;
  /** Live operation: when the volunteer registered. */
  registeredAt?: string;
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export interface IntakeRequest {
  text: string;
  categoryHint?: IncidentCategory;
  locationText: string;
  location?: GeoPoint;
  peopleAffected?: number;
  accessibilityNeeds: Vulnerability[];
  immediateDanger: boolean;
  photoDataUrl?: string;
  language?: string;
  reporterName?: string;
  reporterRelation?: "SELF" | "FAMILY" | "NEIGHBOR" | "OTHER";
  /** Persona id of the resident who submitted the request (verification rights). */
  reporterId?: string;
}

/**
 * What the AI (or the local rules interpreter) *proposes*. Never trusted
 * directly — see engine/validate.ts.
 */
export interface IncidentProposal {
  category: IncidentCategory;
  summary: string;
  peopleAffected: number;
  hazards: Hazard[];
  immediateLifeThreat: boolean;
  vulnerabilities: Vulnerability[];
  needs: NeedType[];
  requestedHelp: string[];
  language: string;
  confidence: number;
}

export type InterpreterProvider = "azure-ai-foundry" | "local-rules";

export interface Interpretation {
  provider: InterpreterProvider;
  model?: string;
  latencyMs: number;
  proposal: IncidentProposal;
  /** Set when Foundry was configured but failed and the local interpreter was used instead. */
  fallbackReason?: string;
}

export interface ValidationNote {
  field: string;
  kind: "ADDED" | "REMOVED" | "CORRECTED" | "KEPT_RESIDENT_VALUE" | "REJECTED";
  message: string;
}

/** The validated, deterministic incident record that triage and matching operate on. */
export interface Assessment {
  category: IncidentCategory;
  summary: string;
  peopleAffected: number;
  hazards: Hazard[];
  immediateLifeThreat: boolean;
  vulnerabilities: Vulnerability[];
  needs: NeedType[];
  requestedHelp: string[];
  language: string;
  /**
   * The reporter describes a road/area condition and says no help is needed.
   * Set only by the deterministic scanner or the resident's own category choice —
   * the AI cannot make a request information-only (that would be a de-escalation).
   */
  informationOnly?: boolean;
}

export interface HazardMention {
  hazard: Hazard;
  phrase: string;
  negated: boolean;
}

export interface Advisory {
  id: string;
  ruleId: string;
  message: string;
  requiresAcknowledgement: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

export interface HazardClearance {
  hazard: Hazard;
  clearedBy: string;
  authority: string;
  note: string;
  at: string;
}

export interface RuleFiring {
  ruleId: string;
  title: string;
  detail: string;
  effect: "ESCALATE" | "RESTRICT" | "REQUIRE" | "ADVISE" | "PERMIT";
}

export interface TriageResult {
  level: TriageLevel;
  civilianDispatchAllowed: boolean;
  rulesFired: RuleFiring[];
  escalateTo: EscalationTarget[];
  doNotDispatch: string[];
  guidance: string[];
  evaluatedAt: string;
}

export interface RequirementSlot {
  id: string;
  kind: "PERSON" | "ASSET";
  label: string;
  skill?: Skill;
  credentials: CredentialType[];
  training: TrainingModuleId[];
  asset?: AssetType;
  quantity: number;
  accessibleRequired?: boolean;
  derivedFrom: string;
  rationale: string;
  /**
   * Supporting role or equipment: the mission can go without it if a coordinator explicitly
   * acknowledges the gap at dispatch. Safety-critical roles (credentialed leads, two-person rules,
   * accessible transport) are never optional.
   */
  optional?: boolean;
}

export interface Priority {
  level: PriorityLevel;
  score: number;
  factors: string[];
}

export type IncidentStatus =
  | "OPEN"
  | "TEAM_FORMING"
  | "ACTIVE"
  | "RESOLVED"
  | "ESCALATED"
  | "LOGGED"
  | "GUIDED"
  | "CANCELLED";

/**
 * Professional escalation. CoORDINATE has NO connection to 911, CAD or
 * utilities: the rules RECOMMEND an escalation; a coordinator makes the
 * contact through normal channels and records it here.
 */
export interface Handoff {
  target: EscalationTarget;
  status: "RECOMMENDED" | "CONTACT_RECORDED" | "ACKNOWLEDGED";
  /** When the rules recommended the escalation. */
  at: string;
  contactedAt?: string;
  contactedBy?: string;
  acknowledgedAt?: string;
  /** Reference the agency gave the coordinator, if any. */
  reference?: string;
  note?: string;
  /** No system-to-system integration exists in this prototype. */
  integration: "none";
  /** WHO: the destination class (derived from the target). */
  destination?: EscalationDestination;
  /** WHY: the rule and plain-language reason. */
  ruleId?: string;
  reason?: string;
  /** Needs this handoff resolves. */
  needIds?: string[];
  /** Suggested trusted contact from the assistance directory. */
  serviceId?: string;
  /** WHAT: a concise summary a person can read out or paste when making contact. */
  summary?: HandoffSummary;
}

export interface HandoffSummary {
  text: string;
  provider: InterpreterProvider;
  model?: string;
  at: string;
}

export interface NeedEvidence {
  /** Words from the request (or form answer) that support the need. */
  phrase: string;
  by: "AI" | "SCANNER" | "RESIDENT_FORM" | "RULES";
}

/**
 * One thing a person needs. An incident (what happened) produces one or more
 * needs; each need gets its own resolution path, status and guidance.
 */
export interface Need {
  id: string;
  type: NeedType;
  origin: NeedOrigin;
  urgency: NeedUrgency;
  path: ResolutionPath;
  status: NeedStatus;
  /** The navigator rule that chose the path, and why. */
  ruleId: string;
  reason: string;
  evidence: NeedEvidence[];
  /** Resident-facing guidance for this need (deterministic text). */
  guidance: string[];
  /** Recommended trusted services (assistance-directory ids), best first. */
  serviceIds: string[];
  /** Escalation targets for PROFESSIONAL_RESPONSE and HUMAN_ESCALATION paths. */
  escalateTo: EscalationTarget[];
  missionId?: string;
  updatedAt: string;
}

export type TimelineActor = "resident" | "ai" | "rules" | "coordinator" | "volunteer" | "authority" | "system";

export interface TimelineEvent {
  at: string;
  actor: TimelineActor;
  message: string;
}

export interface Incident {
  id: string;
  workspaceId: string;
  number: string;
  createdAt: string;
  updatedAt: string;
  source: "RESIDENT_APP" | "PHONE_TRIAGE" | "COORDINATOR";
  request: IntakeRequest;
  location: GeoPoint;
  locality: string;
  locationLabel: string;
  interpretation: Interpretation;
  hazardMentions: HazardMention[];
  validation: ValidationNote[];
  assessment: Assessment;
  hazardClearances: HazardClearance[];
  advisories: Advisory[];
  triage: TriageResult;
  requirements: RequirementSlot[];
  priority: Priority;
  status: IncidentStatus;
  missionId?: string;
  handoffs: Handoff[];
  /** Needs decomposed from the request, each with a resolution path (the navigator result). */
  needs: Need[];
  /** Volunteers who offered to help from their dashboard. */
  offers: string[];
  timeline: TimelineEvent[];
}

/* ------------------------------------------------------------------ */
/* Matching, teams and missions                                        */
/* ------------------------------------------------------------------ */

export type GateId =
  | "SAFETY"
  | "IDENTITY"
  | "AVAILABILITY"
  | "CAPACITY"
  | "SKILL"
  | "CREDENTIALS"
  | "TRAINING"
  | "ASSET"
  | "RANGE";

export interface GateResult {
  gate: GateId;
  passed: boolean;
  detail: string;
}

export interface ScoreComponent {
  label: string;
  points: number;
  max: number;
}

export interface CandidateEvaluation {
  responderId: string;
  name: string;
  kind: Responder["kind"];
  role: Role;
  distanceKm: number;
  eligible: boolean;
  gates: GateResult[];
  score: number;
  scoreBreakdown: ScoreComponent[];
  assetId?: string;
  offered: boolean;
}

export interface SlotMatch {
  slotId: string;
  eligibleCount: number;
  /** Eligible candidates by score, then rejected candidates by distance. */
  candidates: CandidateEvaluation[];
}

export interface Assignment {
  slotId: string;
  responderId: string;
  assetId?: string;
  quantity: number;
  score: number;
  distanceKm: number;
  reasons: string[];
  selectedBy: "ENGINE" | "COORDINATOR";
}

/**
 * Mission lifecycle:
 *   PROPOSED → DISPATCHED (assigned & mobilizing) → IN_PROGRESS (on scene) → COMPLETED → VERIFIED
 *   DISPATCHED ⇄ REROUTING (route changed by reassessment; team acknowledges)
 *   DISPATCHED | REROUTING | IN_PROGRESS → ON_HOLD (policy hold; coordinator resumes once cleared)
 *   any open state → CANCELLED
 */
export type MissionStatus =
  | "PROPOSED"
  | "DISPATCHED"
  | "REROUTING"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "VERIFIED"
  | "CANCELLED";

export interface DispatchCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  /** Failed only because a coordinator hasn't acknowledged it yet (e.g. missing optional equipment). */
  acknowledgeable?: boolean;
}

export interface Mission {
  id: string;
  workspaceId: string;
  number: number;
  code: string;
  title: string;
  incidentId: string;
  status: MissionStatus;
  assignments: Assignment[];
  unfilledSlotIds: string[];
  createdAt: string;
  dispatchedAt?: string;
  startedAt?: string;
  completedAt?: string;
  verifiedAt?: string;
  completionNote?: string;
  verification?: { by: string; note: string };
  dispatchChecks?: DispatchCheck[];
  /** Optional roles/equipment the coordinator chose to dispatch without, with their note. */
  dispatchedWithout?: { slotIds: string[]; labels: string[]; note?: string; by: string };
  briefing?: { text: string; provider: InterpreterProvider; model?: string };
  /** Current planned route from the team's staging point to the site. */
  route?: RoutePlan;
  routeHistory?: RoutePlan[];
  hold?: MissionHold;
  heldFrom?: MissionStatus;
  /** Structured decision evidence (no hidden model reasoning). */
  decisions?: DecisionRecord[];
}
