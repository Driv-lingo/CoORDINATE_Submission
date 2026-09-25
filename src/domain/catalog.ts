import type {
  AccessibilitySupport,
  AssetType,
  CredentialType,
  EscalationDestination,
  EscalationTarget,
  Handoff,
  Hazard,
  IncidentCategory,
  IncidentStatus,
  MissionStatus,
  NeedStatus,
  NeedType,
  NeedUrgency,
  PriorityLevel,
  ResolutionPath,
  Role,
  Skill,
  TrainingModuleId,
  TriageLevel,
  Vulnerability,
} from "./types";

/** Human-readable labels. Kept in one place so UI, AI prompts and docs agree. */

export const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  DEBRIS_CLEARANCE: "Debris / blocked access",
  FLOOD_ASSISTANCE: "Flood assistance",
  ROOF_DAMAGE: "Roof / structure protection",
  SUPPLY_DELIVERY: "Food, water & supplies",
  POWER_NEEDS: "Power & refrigeration",
  TRANSPORTATION: "Transportation",
  WELLNESS_CHECK: "Wellness check",
  SHELTER: "Shelter",
  ROAD_CONDITION_REPORT: "Road / area condition report",
  OTHER: "Other",
};

export const HAZARD_LABELS: Record<Hazard, string> = {
  ACTIVE_FIRE: "Active fire",
  VIOLENCE: "Violence or threat",
  GAS_LEAK: "Suspected gas leak",
  DOWNED_POWER_LINE: "Downed electrical line",
  UNSTABLE_STRUCTURE: "Unstable structure",
  HAZARDOUS_MATERIALS: "Hazardous materials",
  SWIFT_WATER: "Swift / flood water rescue",
  MEDICAL_EMERGENCY: "Medical emergency",
};

export const VULNERABILITY_LABELS: Record<Vulnerability, string> = {
  MOBILITY_LIMITED: "Limited mobility / wheelchair user",
  MEDICAL_DEPENDENCY: "Medical device or medication dependency",
  OLDER_ADULT: "Older adult (65+)",
  CHILDREN: "Infants or children",
  ISOLATED: "Lives alone / isolated",
  LANGUAGE_ACCESS: "Language access need",
  DISABILITY_OTHER: "Sensory or cognitive disability",
};

export const NEED_LABELS: Record<NeedType, string> = {
  TREE_CUTTING: "Tree cutting",
  DEBRIS_REMOVAL: "Debris removal",
  ACCESS_BLOCKED: "Access blocked",
  WATER_MITIGATION: "Water removal",
  MUCK_OUT: "Muck-out / tear-out",
  MOVE_BELONGINGS: "Move belongings",
  ROOF_TARP: "Roof tarp",
  FOOD: "Food",
  WATER: "Drinking water",
  MEDICATION: "Medication pickup",
  POWER_MEDICAL_DEVICE: "Power for medical device",
  DEVICE_CHARGING: "Device charging",
  REFRIGERATION: "Medication refrigeration",
  TRANSPORTATION: "Transportation",
  SHELTER: "Shelter placement",
  WELLNESS_CHECK: "Wellness check",
  GENERATOR_POWER: "Generator hookup (facility)",
  SHELTER_STAFFING: "Shelter staffing",
  EMERGENCY_RESPONSE: "Emergency response",
  HAZARD_RESPONSE: "Hazard made safe by professionals",
  UTILITY_OUTAGE: "Power / utility outage",
  DISASTER_ASSISTANCE: "Disaster assistance (financial)",
  RECOVERY_CASEWORK: "Recovery casework",
  EMOTIONAL_SUPPORT: "Emotional support",
  ROAD_CONDITION: "Road / area condition report",
  GENERAL_GUIDANCE: "Guidance from a person",
};

/** Plain-language need names for residents (no jargon). */
export const NEED_RESIDENT_LABELS: Record<NeedType, string> = {
  TREE_CUTTING: "Cutting and clearing a fallen tree",
  DEBRIS_REMOVAL: "Hauling away storm debris",
  ACCESS_BLOCKED: "Clearing a way in and out",
  WATER_MITIGATION: "Removing water",
  MUCK_OUT: "Tearing out wet drywall and flooring",
  MOVE_BELONGINGS: "Moving belongings to a dry place",
  ROOF_TARP: "Covering a damaged roof",
  FOOD: "Food",
  WATER: "Drinking water",
  MEDICATION: "Getting medication",
  POWER_MEDICAL_DEVICE: "Power for a medical device",
  DEVICE_CHARGING: "Charging phones",
  REFRIGERATION: "Keeping medication cold",
  TRANSPORTATION: "A ride",
  SHELTER: "A safe place to stay",
  WELLNESS_CHECK: "Someone to check on a person",
  GENERATOR_POWER: "Connecting a generator safely",
  SHELTER_STAFFING: "Shelter volunteers",
  EMERGENCY_RESPONSE: "Emergency help",
  HAZARD_RESPONSE: "Making a dangerous hazard safe",
  UTILITY_OUTAGE: "Getting the power back on",
  DISASTER_ASSISTANCE: "Help paying for damage",
  RECOVERY_CASEWORK: "Help planning your recovery",
  EMOTIONAL_SUPPORT: "Someone to talk to",
  ROAD_CONDITION: "Your road report",
  GENERAL_GUIDANCE: "Talking it through with a person",
};

export const RESOLUTION_PATH_LABELS: Record<ResolutionPath, { label: string; resident: string; description: string }> = {
  PROFESSIONAL_RESPONSE: { label: "Professional response", resident: "Emergency professionals", description: "Only trained professionals (911, the utility, a building official) may handle this. No community mission is created." },
  HUMAN_ESCALATION: { label: "Human escalation", resident: "A person will follow up", description: "A caseworker, shelter coordinator or community coordinator should take this over. CoORDINATE prepares the handoff summary; a person makes the contact." },
  COMMUNITY_MISSION: { label: "Community mission", resident: "Community help available", description: "Qualified, verified community volunteers can do this, if the resident asks. Becomes capability requirements, a team and a mission." },
  RESOURCE_TRANSFER: { label: "Resource transfer", resident: "Equipment can be brought to you", description: "A physical resource (battery station, refrigeration, generator) is matched and delivered as a logistics mission." },
  SERVICE_REFERRAL: { label: "Service referral", resident: "Trusted service", description: "An established program already does this. CoORDINATE points to it with its source and any eligibility conditions." },
  INFORMATION: { label: "Information", resident: "What to know", description: "Trusted guidance answers the need." },
  SITUATIONAL_AWARENESS: { label: "Situational awareness", resident: "Shared with coordinators", description: "The report joins the operational picture; corroborated conditions can restrict routes." },
};

export const NEED_STATUS_LABELS: Record<NeedStatus, string> = {
  IDENTIFIED: "Guidance given",
  HELP_AVAILABLE: "Community help available",
  HELP_REQUESTED: "Help requested",
  MISSION_ACTIVE: "Team working on it",
  BLOCKED_BY_HAZARD: "On hold — hazard must be made safe first",
  ESCALATION_RECOMMENDED: "Handoff recommended",
  HANDED_OFF: "Handed off (recorded)",
  RESOLVED: "Resolved",
  NOT_REQUESTED: "Not requested",
};

export const URGENCY_LABELS: Record<NeedUrgency, string> = {
  IMMEDIATE: "Now",
  TODAY: "Today",
  SOON: "Next few days",
  RECOVERY: "Recovery",
};

export const DESTINATION_LABELS: Record<EscalationDestination, string> = {
  EMERGENCY_SERVICES: "Emergency services (911)",
  PROFESSIONAL_RESPONDER: "Professional responder",
  EMERGENCY_MANAGEMENT: "Emergency management",
  HUMAN_CASEWORKER: "Disaster caseworker",
  NONPROFIT_PARTNER: "Nonprofit partner",
  UTILITY_PROVIDER: "Utility provider",
  SHELTER_COORDINATOR: "Shelter coordinator",
  COMMUNITY_COORDINATOR: "Community coordinator",
};

/** Which destination class each concrete escalation target belongs to. */
export const ESCALATION_DESTINATION: Record<EscalationTarget, EscalationDestination> = {
  EMS_911: "EMERGENCY_SERVICES",
  FIRE_RESCUE_911: "EMERGENCY_SERVICES",
  LAW_ENFORCEMENT_911: "EMERGENCY_SERVICES",
  SWIFT_WATER_RESCUE_911: "EMERGENCY_SERVICES",
  ELECTRIC_UTILITY: "UTILITY_PROVIDER",
  GAS_UTILITY: "UTILITY_PROVIDER",
  BUILDING_OFFICIAL: "PROFESSIONAL_RESPONDER",
  HAZMAT_EMERGENCY_MANAGEMENT: "EMERGENCY_MANAGEMENT",
  HUMAN_CASEWORKER: "HUMAN_CASEWORKER",
  NONPROFIT_PARTNER: "NONPROFIT_PARTNER",
  SHELTER_COORDINATOR: "SHELTER_COORDINATOR",
  COMMUNITY_COORDINATOR: "COMMUNITY_COORDINATOR",
};

export const SKILL_LABELS: Record<Skill, string> = {
  GENERAL_LABOR: "General labor",
  CHAINSAW_OPERATION: "Chainsaw operation",
  ROOF_TARPING: "Roof tarping",
  FLOOD_CLEANUP: "Flood cleanup",
  DRIVING: "Driving / delivery",
  ACCESSIBLE_TRANSPORT: "Accessible transport",
  FIRST_AID: "First aid",
  WELLNESS_VISITS: "Wellness visits",
  ELECTRICAL: "Electrical trade",
  FOOD_SERVICE: "Food service",
  SHELTER_OPERATIONS: "Shelter operations",
};

export const CREDENTIAL_LABELS: Record<CredentialType, string> = {
  BACKGROUND_CHECK: "Background check",
  DRIVERS_LICENSE: "Driver's license",
  CHAINSAW_SAFETY: "Chainsaw safety & operation",
  ROOF_FALL_PROTECTION: "Roof work / fall protection",
  CERT_BASIC: "CERT basic training",
  FIRST_AID_CPR: "First Aid / CPR / AED",
  WHEELCHAIR_SECUREMENT: "Wheelchair securement",
  LICENSED_ELECTRICIAN: "Licensed electrician",
  FOOD_HANDLER: "Food handler",
};

export const TRAINING_LABELS: Record<TrainingModuleId, { title: string; minutes: number; summary: string; competencies: string[]; check: { q: string; right: string; wrong: string } }> = {
  ORIENTATION: {
    title: "Disaster volunteer orientation",
    minutes: 25,
    summary: "How CoORDINATE missions work, check-in/check-out, reporting hazards, and when to stop and escalate.",
    competencies: ["Mission check-in", "Hazard reporting", "Stop-work authority"],
    check: { q: "You arrive and see a wire down across the driveway. What do you do?", right: "Stay back, stop work, call the coordinator", wrong: "Move it with a dry branch" },
  },
  FLOOD_CLEANUP_SAFETY: {
    title: "Flood cleanup safety & mold awareness",
    minutes: 40,
    summary: "PPE, electrical isolation before entering flooded rooms, contaminated water, mold, and safe muck-out practice.",
    competencies: ["PPE selection", "Contaminated water precautions", "Safe tear-out"],
    check: { q: "Before entering a flooded basement you must…", right: "Confirm power to it is off and wear PPE", wrong: "Start pumping right away" },
  },
  GENERATOR_CO_SAFETY: {
    title: "Generator & carbon monoxide safety",
    minutes: 20,
    summary: "Never indoors, 20-foot rule, CO symptoms, and why portable battery stations are preferred for medical devices.",
    competencies: ["Generator placement", "CO recognition"],
    check: { q: "Where may a portable generator run?", right: "Outdoors, 20+ ft from doors and windows", wrong: "In an open garage" },
  },
  PSYCH_FIRST_AID_INTRO: {
    title: "Psychological first aid — introduction",
    minutes: 30,
    summary: "Listening, stabilizing, and connecting survivors to services during wellness visits.",
    competencies: ["Supportive listening", "Referral to services"],
    check: { q: "A resident is distressed during a wellness visit. First step?", right: "Listen, stay calm, connect them to services", wrong: "Tell them it could be worse" },
  },
  ACCESSIBLE_EVAC_BASICS: {
    title: "Accessible evacuation basics",
    minutes: 30,
    summary: "Respectful assistance for people with disabilities, service animals, and mobility equipment.",
    competencies: ["Disability etiquette", "Mobility equipment handling"],
    check: { q: "A wheelchair user needs help. You should…", right: "Ask how they want to be assisted", wrong: "Lift them without asking" },
  },
  CHAINSAW_AWARENESS: {
    title: "Chainsaw hazard awareness (classroom)",
    minutes: 35,
    summary: "Recognizing spring poles, bind and kickback. Awareness only — does NOT qualify anyone to operate a chainsaw.",
    competencies: ["Cut-zone awareness", "Spotter role"],
    check: { q: "Does this module let you run a saw on a mission?", right: "No — a verified external credential is required", wrong: "Yes, once the badge is earned" },
  },
};

export const ASSET_LABELS: Record<AssetType, string> = {
  PICKUP_TRUCK: "Pickup truck",
  TRAILER: "Utility trailer",
  CHAINSAW: "Chainsaw",
  GENERATOR: "Generator",
  PORTABLE_BATTERY: "Portable battery station",
  ACCESSIBLE_VAN: "Wheelchair-accessible van",
  PASSENGER_VEHICLE: "Passenger vehicle",
  FOOD_SUPPLY: "Food (meals)",
  WATER_SUPPLY: "Drinking water (gal)",
  SHELTER_BEDS: "Shelter beds",
  REFRIGERATION: "Refrigeration unit",
  HAND_TOOLS: "Hand tools",
  TARPS: "Tarps",
  WATER_PUMP: "Water pump",
  WET_VAC: "Wet/dry vacuum",
  LADDER: "Extension ladder",
};

export const ROLE_LABELS: Record<Role, string> = {
  RESIDENT: "Resident",
  GENERAL_VOLUNTEER: "General volunteer",
  TRAINED_VOLUNTEER: "Trained volunteer",
  SKILLED_PROFESSIONAL: "Skilled professional",
  NONPROFIT: "Nonprofit / community org",
  BUSINESS: "Business / resource provider",
  COORDINATOR: "Authorized coordinator",
};

export const ACCESSIBILITY_SUPPORT_LABELS: Record<AccessibilitySupport, string> = {
  WHEELCHAIR_TRANSPORT: "Wheelchair transport",
  MOBILITY_ASSIST: "Mobility assistance",
  ASL: "American Sign Language",
  SENSORY_FRIENDLY: "Sensory-friendly support",
};

export const TRIAGE_LABELS: Record<TriageLevel, { label: string; short: string; description: string }> = {
  LIFE_SAFETY_EMERGENCY: {
    label: "Emergency escalation",
    short: "EMERGENCY",
    description: "Immediate threat to life. Professional emergency escalation recommended — the resident is told to call 911. No civilian mission can be created.",
  },
  PROFESSIONAL_RESPONSE_REQUIRED: {
    label: "Professional response required",
    short: "PROFESSIONAL",
    description: "Hazard requires a utility, public-safety or building authority. Civilian dispatch prohibited until the authority clears it.",
  },
  SPECIALIZED_VOLUNTEER_ELIGIBLE: {
    label: "Specialized volunteer eligible",
    short: "SPECIALIZED",
    description: "Civilian mission permitted only with a volunteer holding a verified professional license (e.g. licensed electrician).",
  },
  TRAINED_VOLUNTEER_ELIGIBLE: {
    label: "Trained volunteer eligible",
    short: "TRAINED",
    description: "Civilian mission permitted, but at least one role requires a verified external credential.",
  },
  GENERAL_VOLUNTEER_ELIGIBLE: {
    label: "General volunteer eligible",
    short: "GENERAL",
    description: "Civilian mission permitted for identity-verified community volunteers.",
  },
  INFORMATION_ONLY: {
    label: "Information only",
    short: "INFO",
    description: "No assistance requested. Logged to the operational picture as an unverified community report; a coordinator can convert it into a request.",
  },
};

export const HANDOFF_STATUS_LABELS: Record<Handoff["status"], string> = {
  RECOMMENDED: "Escalation recommended",
  CONTACT_RECORDED: "Contact recorded by coordinator",
  ACKNOWLEDGED: "Agency acknowledged (recorded)",
};

export const ESCALATION_LABELS: Record<EscalationTarget, string> = {
  EMS_911: "EMS via 911",
  FIRE_RESCUE_911: "Fire & Rescue via 911",
  LAW_ENFORCEMENT_911: "Law enforcement via 911",
  SWIFT_WATER_RESCUE_911: "Swift-water rescue team via 911",
  ELECTRIC_UTILITY: "Electric utility — hazard line",
  GAS_UTILITY: "Gas utility — emergency line",
  BUILDING_OFFICIAL: "Local building official",
  HAZMAT_EMERGENCY_MANAGEMENT: "HazMat team via emergency management",
  HUMAN_CASEWORKER: "Disaster recovery caseworker",
  NONPROFIT_PARTNER: "Nonprofit partner",
  SHELTER_COORDINATOR: "Shelter coordinator (accessible placement)",
  COMMUNITY_COORDINATOR: "Community coordinator call-back",
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus | "AWAITING_RESOURCES", string> = {
  OPEN: "Open",
  AWAITING_RESOURCES: "Awaiting resources",
  TEAM_FORMING: "Team forming",
  ACTIVE: "Active mission",
  RESOLVED: "Completed",
  ESCALATED: "Escalated",
  LOGGED: "Logged · info only",
  GUIDED: "Guided · no mission requested",
  CANCELLED: "Cancelled",
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  PROPOSED: "Team proposed",
  DISPATCHED: "Assigned · mobilizing",
  REROUTING: "Rerouting",
  ON_HOLD: "On hold",
  IN_PROGRESS: "On scene",
  COMPLETED: "Completed — awaiting verification",
  VERIFIED: "Verified complete",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  P1: "Critical",
  P2: "Urgent",
  P3: "Priority",
  P4: "Routine",
};
