import type { AssistanceService } from "@/domain/assistance";
import type { Geometry } from "@/domain/ops";

/**
 * Trusted Assistance Directory — a small, Virginia-focused seed.
 *
 * Two kinds of entries:
 *  - STANDING services (simulated: false): real public programs and lines,
 *    compiled from each provider's published contact information. Only
 *    contacts the maintainers are confident of are listed; where a phone
 *    number was not certain, only the provider's website is given.
 *    `lastVerifiedAt` is the date the entry was compiled. The development
 *    sandbox cannot reach these sites, so every entry must be re-checked
 *    against `authoritativeSource` before an operational deployment.
 *  - EXERCISE activations (simulated: true): open shelters, distribution
 *    points and casework desks that exist only in the fictional TS Delphine
 *    scenario. They are never shown in a live workspace.
 */

const box = (minLng: number, minLat: number, maxLng: number, maxLat: number): Geometry => ({
  type: "Polygon",
  coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]],
});

/** Contiguous United States (coarse). */
const USA = box(-125, 24, -66.5, 49.5);
/** Virginia (bounding box — coarse by design). */
const VIRGINIA = box(-83.7, 36.5, -75.2, 39.5);
/** Roanoke Valley and surrounding counties. */
const ROANOKE_VALLEY = box(-80.5, 37.0, -79.6, 37.5);
/** NWS Blacksburg forecast area (approximate). */
const SW_VIRGINIA = box(-83.7, 36.5, -78.5, 38.2);

const COMPILED = "2026-09-22";

export const ASSISTANCE_DIRECTORY: AssistanceService[] = [
  /* ------------------------- standing services ------------------------- */
  {
    id: "svc-911",
    name: "911 — police, fire, EMS",
    provider: "Local emergency communications centers",
    description: "Anyone injured, trapped, in rising water, or facing fire, a gas leak or a downed power line.",
    serviceTypes: ["EMERGENCY_SERVICES"],
    geography: USA,
    geographyLabel: "United States",
    contactMethods: [{ kind: "PHONE", value: "911", label: "Call" }],
    authoritativeSource: "https://www.911.gov",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-fema-ia",
    name: "FEMA Individual Assistance",
    provider: "Federal Emergency Management Agency",
    description: "Grants for temporary housing, repairs and other disaster needs not covered by insurance.",
    serviceTypes: ["DISASTER_ASSISTANCE"],
    geography: USA,
    geographyLabel: "United States",
    eligibility: [
      { id: "fema-declaration", description: "Available only where a federal major disaster declaration with Individual Assistance covers your county.", requires: "FEDERAL_DECLARATION" },
      { id: "fema-insurance", description: "Contact your insurer first; FEMA does not duplicate insurance payments." },
    ],
    contactMethods: [
      { kind: "WEB", value: "https://www.disasterassistance.gov", label: "Apply at DisasterAssistance.gov" },
      { kind: "PHONE", value: "1-800-621-3362", label: "FEMA helpline" },
    ],
    authoritativeSource: "https://www.disasterassistance.gov",
    lastVerifiedAt: COMPILED,
    simulated: false,
    languages: ["en", "es"],
  },
  {
    id: "svc-sba-disaster",
    name: "SBA disaster loans",
    provider: "U.S. Small Business Administration",
    description: "Low-interest loans for homeowners, renters and businesses to repair or replace damaged property.",
    serviceTypes: ["RECOVERY_LOANS"],
    geography: USA,
    geographyLabel: "United States",
    eligibility: [{ id: "sba-declaration", description: "Available only after a disaster declaration covers your area.", requires: "FEDERAL_DECLARATION" }],
    contactMethods: [
      { kind: "WEB", value: "https://www.sba.gov/funding-programs/disaster-assistance", label: "SBA disaster assistance" },
      { kind: "PHONE", value: "1-800-659-2955", label: "SBA disaster customer service" },
    ],
    authoritativeSource: "https://www.sba.gov/funding-programs/disaster-assistance",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-vdem",
    name: "Virginia Department of Emergency Management",
    provider: "Commonwealth of Virginia",
    description: "Statewide emergency information, declarations and recovery program updates.",
    serviceTypes: ["EMERGENCY_MANAGEMENT", "DISASTER_ASSISTANCE"],
    geography: VIRGINIA,
    geographyLabel: "Virginia",
    contactMethods: [{ kind: "WEB", value: "https://www.vaemergency.gov", label: "vaemergency.gov" }],
    authoritativeSource: "https://www.vaemergency.gov",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-211va",
    name: "2-1-1 Virginia",
    provider: "Virginia Department of Social Services / 2-1-1 Virginia",
    description: "Free, confidential referrals to local food, shelter, transportation, utility and recovery help.",
    serviceTypes: ["INFORMATION_REFERRAL", "FOOD", "SHELTER", "TRANSPORTATION", "CASE_MANAGEMENT"],
    geography: VIRGINIA,
    geographyLabel: "Virginia",
    contactMethods: [
      { kind: "PHONE", value: "211", label: "Dial", hours: "24/7" },
      { kind: "WEB", value: "https://www.211virginia.org", label: "211virginia.org" },
    ],
    authoritativeSource: "https://www.211virginia.org",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-redcross",
    name: "American Red Cross — disaster help",
    provider: "American Red Cross",
    description: "Emergency shelter, meals, and disaster casework for households affected by a disaster.",
    serviceTypes: ["SHELTER", "CASE_MANAGEMENT", "FOOD"],
    geography: USA,
    geographyLabel: "United States",
    contactMethods: [
      { kind: "PHONE", value: "1-800-733-2767", label: "Red Cross (1-800-RED CROSS)" },
      { kind: "WEB", value: "https://www.redcross.org/get-help.html", label: "Get help (incl. open shelters)" },
    ],
    authoritativeSource: "https://www.redcross.org/get-help.html",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-ddh",
    name: "Disaster Distress Helpline",
    provider: "SAMHSA (U.S. Department of Health and Human Services)",
    description: "Free, confidential crisis counseling for anyone experiencing distress after a disaster.",
    serviceTypes: ["CRISIS_COUNSELING"],
    geography: USA,
    geographyLabel: "United States",
    contactMethods: [
      { kind: "PHONE", value: "1-800-985-5990", label: "Call", hours: "24/7" },
      { kind: "TEXT", value: "1-800-985-5990", label: "Text" },
    ],
    authoritativeSource: "https://www.samhsa.gov/find-help/disaster-distress-helpline",
    lastVerifiedAt: COMPILED,
    simulated: false,
    languages: ["en", "es"],
  },
  {
    id: "svc-988",
    name: "988 Suicide & Crisis Lifeline",
    provider: "988 Lifeline (SAMHSA)",
    description: "Immediate support for anyone thinking about suicide or in emotional crisis.",
    serviceTypes: ["CRISIS_COUNSELING"],
    geography: USA,
    geographyLabel: "United States",
    contactMethods: [
      { kind: "PHONE", value: "988", label: "Call", hours: "24/7" },
      { kind: "TEXT", value: "988", label: "Text" },
    ],
    authoritativeSource: "https://988lifeline.org",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-511va",
    name: "511 Virginia",
    provider: "Virginia Department of Transportation",
    description: "Road closures, incidents and travel conditions.",
    serviceTypes: ["ROAD_CONDITIONS"],
    geography: VIRGINIA,
    geographyLabel: "Virginia",
    contactMethods: [
      { kind: "PHONE", value: "511", label: "Dial" },
      { kind: "WEB", value: "https://www.511virginia.org", label: "511virginia.org" },
    ],
    authoritativeSource: "https://www.511virginia.org",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-nws-rnk",
    name: "National Weather Service — Blacksburg",
    provider: "NOAA National Weather Service",
    description: "Official watches and warnings for southwest Virginia, including the Roanoke Valley.",
    serviceTypes: ["WEATHER_ALERTS"],
    geography: SW_VIRGINIA,
    geographyLabel: "Southwest Virginia",
    contactMethods: [{ kind: "WEB", value: "https://www.weather.gov/rnk", label: "weather.gov/rnk" }],
    authoritativeSource: "https://www.weather.gov/rnk",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-apco-outage",
    name: "Appalachian Power — report an outage",
    provider: "Appalachian Power",
    description: "Report a power outage or a downed line to the utility that serves most of the Roanoke Valley. Check your bill if you are unsure who your provider is.",
    serviceTypes: ["UTILITY_OUTAGE"],
    geography: ROANOKE_VALLEY,
    geographyLabel: "Roanoke Valley",
    contactMethods: [{ kind: "WEB", value: "https://www.appalachianpower.com/outages/", label: "Outage center (or the number on your bill)" }],
    authoritativeSource: "https://www.appalachianpower.com/outages/",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-feeding-swva",
    name: "Feeding Southwest Virginia",
    provider: "Feeding Southwest Virginia (regional food bank)",
    description: "Finds food pantries and distribution sites near you.",
    serviceTypes: ["FOOD", "WATER"],
    geography: SW_VIRGINIA,
    geographyLabel: "Southwest Virginia",
    contactMethods: [{ kind: "WEB", value: "https://www.feedingswva.org", label: "feedingswva.org — find food" }],
    authoritativeSource: "https://www.feedingswva.org",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-vdss-dsnap",
    name: "Disaster SNAP (D-SNAP)",
    provider: "Virginia Department of Social Services",
    description: "Temporary food benefits after a disaster, when the program is activated for your area.",
    serviceTypes: ["FOOD"],
    geography: VIRGINIA,
    geographyLabel: "Virginia",
    eligibility: [{ id: "dsnap-activation", description: "Only when D-SNAP is activated for your locality after a federal declaration.", requires: "STATE_ACTIVATION" }],
    contactMethods: [{ kind: "WEB", value: "https://www.dss.virginia.gov", label: "dss.virginia.gov" }],
    authoritativeSource: "https://www.dss.virginia.gov",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },
  {
    id: "svc-roanoke-oem",
    name: "Local emergency management (Roanoke City / Roanoke County)",
    provider: "City of Roanoke and Roanoke County",
    description: "Local shelter openings, evacuation orders and recovery information.",
    serviceTypes: ["EMERGENCY_MANAGEMENT", "INFORMATION_REFERRAL"],
    geography: ROANOKE_VALLEY,
    geographyLabel: "Roanoke Valley",
    contactMethods: [
      { kind: "WEB", value: "https://www.roanokeva.gov", label: "roanokeva.gov" },
      { kind: "WEB", value: "https://www.roanokecountyva.gov", label: "roanokecountyva.gov" },
    ],
    authoritativeSource: "https://www.roanokeva.gov",
    lastVerifiedAt: COMPILED,
    simulated: false,
  },

  /* ------------------ exercise activations (fictional) ------------------ */
  {
    id: "ex-shelter-grace",
    name: "Grace Fellowship Shelter (exercise)",
    provider: "Grace Fellowship (fictional) with Roanoke Valley EOC",
    description: "Open shelter with accessible beds, meals and charging. Pets in carriers accepted.",
    serviceTypes: ["SHELTER", "FOOD", "CHARGING"],
    geography: ROANOKE_VALLEY,
    geographyLabel: "Salem · Roanoke Valley",
    contactMethods: [{ kind: "IN_PERSON", value: "Salem (exercise location)", label: "Open 24 hours during the exercise" }],
    authoritativeSource: "TS Delphine exercise — simulated EOC shelter list",
    lastVerifiedAt: COMPILED,
    simulated: true,
    accessible: true,
  },
  {
    id: "ex-resource-center",
    name: "Star City Resource Point (exercise)",
    provider: "Star City Community Pantry (fictional)",
    description: "Water, shelf-stable meals and phone charging, 8 am – 8 pm.",
    serviceTypes: ["FOOD", "WATER", "CHARGING"],
    geography: ROANOKE_VALLEY,
    geographyLabel: "Downtown Roanoke",
    contactMethods: [{ kind: "IN_PERSON", value: "Downtown Roanoke (exercise location)", label: "Walk-up distribution" }],
    authoritativeSource: "TS Delphine exercise — simulated distribution-point list",
    lastVerifiedAt: COMPILED,
    simulated: true,
    accessible: true,
  },
  {
    id: "ex-access-rides",
    name: "Valley Access Rides (exercise)",
    provider: "Valley Access Rides (fictional nonprofit)",
    description: "Wheelchair-accessible rides to shelters and medical appointments during the storm response.",
    serviceTypes: ["TRANSPORTATION"],
    geography: ROANOKE_VALLEY,
    geographyLabel: "Roanoke Valley",
    contactMethods: [{ kind: "PHONE", value: "(exercise — no real number)", label: "Booked through the EOC" }],
    authoritativeSource: "TS Delphine exercise — simulated partner roster",
    lastVerifiedAt: COMPILED,
    simulated: true,
    accessible: true,
  },
  {
    id: "ex-casework-desk",
    name: "Disaster Recovery Casework Desk (exercise)",
    provider: "Roanoke Valley VOAD (fictional)",
    description: "Caseworkers help households plan repairs, insurance claims and applications.",
    serviceTypes: ["CASE_MANAGEMENT"],
    geography: ROANOKE_VALLEY,
    geographyLabel: "Roanoke Valley",
    contactMethods: [{ kind: "IN_PERSON", value: "Recovery center (exercise location)", label: "Appointments via the EOC" }],
    authoritativeSource: "TS Delphine exercise — simulated VOAD roster",
    lastVerifiedAt: COMPILED,
    simulated: true,
  },
];

const BY_ID = new Map(ASSISTANCE_DIRECTORY.map((s) => [s.id, s]));

export function getService(id: string): AssistanceService | undefined {
  return BY_ID.get(id);
}
