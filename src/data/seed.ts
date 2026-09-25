import { interpretLocally } from "@/ai/localInterpreter";
import { templateBriefing, withSafety } from "@/ai/templates";
import type { CameraResource, OperationalEvent } from "@/domain/ops";
import type {
  Asset,
  AssetType,
  Credential,
  CredentialStatus,
  CredentialType,
  GeoPoint,
  Incident,
  IntakeRequest,
  Mission,
  Responder,
  TrainingModuleId,
} from "@/domain/types";
import { correlate, restrictionsFrom } from "@/engine/correlate";
import {
  acknowledgeAdvisory,
  attachRoute,
  completeMission,
  dispatch,
  proposeTeam,
  recordHandoffAcknowledgement,
  recordHandoffContact,
  requestCommunityHelp,
  resolveNeedRecord,
  startMission,
  verifyMission,
} from "@/engine/lifecycle";
import { buildIncident } from "@/engine/pipeline";
import { missionEndpoints, planDeterministicRoute } from "@/engine/routing";
import { leadResponder } from "@/engine/team";
import { workspaceMode } from "./mode";
import { baselineCameras, baselineEvents, communityReportFromIncident } from "./scenarioOps";

/**
 * Seed scenario — FICTIONAL.
 *
 * Remnants of fictional Tropical Storm Delphine stall over the Roanoke Valley,
 * Virginia, producing river flooding and wind damage. All people,
 * organizations and requests are invented. Locations are neighborhood-level
 * approximations. The scenario is replayed through the real intake pipeline
 * and mission lifecycle at seed time, relative to "now", so the dashboard
 * always looks live.
 */

export const SCENARIO = {
  name: "TS Delphine — Roanoke Valley",
  description: "Fictional exercise: remnants of Tropical Storm Delphine cause Roanoke River flooding and widespread tree damage.",
  coordinator: { id: "coord-ellis", name: "Ellis Morgan", title: "Volunteer Coordination Lead, Roanoke Valley EOC (fictional)" },
  resident: { id: "resident-denise", name: "Denise Walker" },
  /** First mission number used by the seed; the seed consumes 015–020 so the first live mission is MSN-021. */
  firstMissionNumber: 15,
  firstIncidentNumber: 1041,
};

const DAY = 864e5;

function cred(type: CredentialType, issuer: string, now: Date, opts: { status?: CredentialStatus; expiresInDays?: number; verifiedDaysAgo?: number } = {}): Credential {
  const status = opts.status ?? "VERIFIED";
  return {
    type,
    status,
    issuer,
    reference: `${type.slice(0, 3)}-${Math.abs(hash(issuer + type)) % 90000 + 10000}`,
    verifiedAt: status === "PENDING" ? undefined : new Date(now.getTime() - (opts.verifiedDaysAgo ?? 120) * DAY).toISOString(),
    verifiedBy: status === "PENDING" ? undefined : "Roanoke Valley VOAD verification desk (fictional)",
    expiresAt: opts.expiresInDays === undefined ? undefined : new Date(now.getTime() + opts.expiresInDays * DAY).toISOString(),
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const trained = (ids: TrainingModuleId[], now: Date) => ids.map((moduleId, i) => ({ moduleId, completedAt: new Date(now.getTime() - (200 - i * 30) * DAY).toISOString() }));

const asset = (owner: string, type: AssetType, label: string, quantity = 1, extra: Partial<Asset> = {}): Asset => ({
  id: `${owner}-${type.toLowerCase().replace(/_/g, "-")}`,
  type,
  label,
  quantity,
  ...extra,
});

const BG = "Volunteer screening partner (external)";
const DL = "Virginia DMV (external)";
const CPR = "Accredited First Aid/CPR/AED provider";
const CERT = "Local CERT program — FEMA curriculum";

type ResponderSeed = Omit<Responder, "workspaceId">;

export function seedResponders(now: Date): ResponderSeed[] {
  const P = (x: Omit<ResponderSeed, "kind" | "accessibilitySupport" | "languages" | "availability" | "training" | "assets"> & Partial<ResponderSeed>): ResponderSeed => ({
    kind: "PERSON",
    accessibilitySupport: [],
    languages: ["en"],
    availability: { status: "AVAILABLE" },
    training: [],
    assets: [],
    ...x,
  });
  const O = (x: Omit<ResponderSeed, "kind" | "accessibilitySupport" | "languages" | "availability" | "training" | "skills"> & Partial<ResponderSeed>): ResponderSeed => ({
    kind: "ORGANIZATION",
    accessibilitySupport: [],
    languages: ["en"],
    availability: { status: "AVAILABLE" },
    training: [],
    skills: [],
    ...x,
  });

  return [
    P({
      id: "r-jordan",
      role: "TRAINED_VOLUNTEER",
      name: "Jordan Reyes",
      headline: "Sawyer · community tree-crew volunteer",
      locality: "Salem",
      location: { lat: 37.287, lng: -80.045 },
      maxTravelKm: 35,
      identityVerified: true,
      skills: ["CHAINSAW_OPERATION", "GENERAL_LABOR"],
      credentials: [
        cred("CHAINSAW_SAFETY", "Regional sawyer safety & operation course (Level 2)", now, { expiresInDays: 540 }),
        cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 600 }),
        cred("FIRST_AID_CPR", CPR, now, { expiresInDays: 300 }),
      ],
      training: trained(["ORIENTATION", "CHAINSAW_AWARENESS"], now),
      stats: { missionsCompleted: 7, hoursContributed: 46 },
    }),
    P({
      id: "r-priya",
      role: "TRAINED_VOLUNTEER",
      name: "Priya Natarajan",
      headline: "CERT community responder",
      locality: "Raleigh Court",
      location: { lat: 37.2645, lng: -79.9772 },
      maxTravelKm: 20,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "FIRST_AID", "WELLNESS_VISITS"],
      credentials: [cred("CERT_BASIC", CERT, now), cred("FIRST_AID_CPR", CPR, now, { expiresInDays: 400 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 500 })],
      training: trained(["ORIENTATION", "PSYCH_FIRST_AID_INTRO", "ACCESSIBLE_EVAC_BASICS"], now),
      languages: ["en", "ta"],
      accessibilitySupport: ["MOBILITY_ASSIST"],
      stats: { missionsCompleted: 5, hoursContributed: 31 },
    }),
    P({
      id: "r-marcus",
      role: "GENERAL_VOLUNTEER",
      name: "Marcus Hale",
      headline: "Neighbor with a truck and a chainsaw",
      locality: "Cave Spring",
      location: { lat: 37.2318, lng: -80.0072 },
      maxTravelKm: 15,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "CHAINSAW_OPERATION", "DRIVING"],
      credentials: [
        cred("CHAINSAW_SAFETY", "Uploaded certificate — awaiting verification", now, { status: "PENDING" }),
        cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 900 }),
      ],
      training: trained(["ORIENTATION"], now),
      assets: [asset("r-marcus", "CHAINSAW", "Chainsaw (18-inch)"), asset("r-marcus", "PICKUP_TRUCK", "Pickup truck")],
      stats: { missionsCompleted: 1, hoursContributed: 4 },
    }),
    P({
      id: "r-dana",
      role: "SKILLED_PROFESSIONAL",
      name: "Dana Whitfield",
      headline: "Licensed electrician",
      locality: "Vinton",
      location: { lat: 37.279, lng: -79.889 },
      maxTravelKm: 30,
      identityVerified: true,
      skills: ["ELECTRICAL", "GENERAL_LABOR", "DRIVING"],
      credentials: [
        cred("LICENSED_ELECTRICIAN", "Virginia DPOR tradesman license (external)", now, { expiresInDays: 700 }),
        cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 450 }),
        cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 1200 }),
      ],
      training: trained(["ORIENTATION", "GENERATOR_CO_SAFETY"], now),
      assets: [asset("r-dana", "GENERATOR", "Portable generator (7 kW)")],
      stats: { missionsCompleted: 3, hoursContributed: 20 },
    }),
    P({
      id: "r-luis",
      role: "GENERAL_VOLUNTEER",
      name: "Luis Ortega",
      headline: "Bilingual volunteer (ES/EN) · flood cleanup",
      locality: "Garden City",
      location: { lat: 37.2388, lng: -79.9212 },
      maxTravelKm: 20,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "DRIVING", "FLOOD_CLEANUP"],
      credentials: [cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 800 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 500 })],
      training: trained(["ORIENTATION", "FLOOD_CLEANUP_SAFETY"], now),
      languages: ["es", "en"],
      assets: [asset("r-luis", "PICKUP_TRUCK", "Pickup truck")],
      stats: { missionsCompleted: 4, hoursContributed: 28 },
    }),
    P({
      id: "r-sarah",
      role: "TRAINED_VOLUNTEER",
      name: "Sarah Kim",
      headline: "Accessible-transport driver",
      locality: "Hollins",
      location: { lat: 37.338, lng: -79.948 },
      maxTravelKm: 30,
      identityVerified: true,
      skills: ["DRIVING", "ACCESSIBLE_TRANSPORT"],
      credentials: [
        cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 1000 }),
        cred("WHEELCHAIR_SECUREMENT", "Passenger assistance & securement course (external)", now, { expiresInDays: 380 }),
        cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 520 }),
      ],
      training: trained(["ORIENTATION", "ACCESSIBLE_EVAC_BASICS"], now),
      accessibilitySupport: ["WHEELCHAIR_TRANSPORT", "MOBILITY_ASSIST"],
      assets: [asset("r-sarah", "PASSENGER_VEHICLE", "Minivan")],
      stats: { missionsCompleted: 9, hoursContributed: 60 },
    }),
    P({
      id: "r-tom",
      role: "GENERAL_VOLUNTEER",
      name: "Tom Brennan",
      headline: "Retired contractor",
      locality: "Williamson Road",
      location: { lat: 37.3045, lng: -79.944 },
      maxTravelKm: 25,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "DRIVING"],
      credentials: [cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 600 }), cred("BACKGROUND_CHECK", BG, now, { status: "PENDING" })],
      training: trained(["ORIENTATION"], now),
      assets: [asset("r-tom", "PICKUP_TRUCK", "Pickup truck"), asset("r-tom", "HAND_TOOLS", "Contractor tool kit"), asset("r-tom", "LADDER", "28-ft extension ladder")],
      stats: { missionsCompleted: 2, hoursContributed: 12 },
    }),
    P({
      id: "r-aisha",
      role: "TRAINED_VOLUNTEER",
      name: "Aisha Mohammed",
      headline: "CERT member · first aid",
      locality: "Southeast Roanoke",
      location: { lat: 37.256, lng: -79.929 },
      maxTravelKm: 20,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "FIRST_AID", "WELLNESS_VISITS"],
      credentials: [cred("CERT_BASIC", CERT, now), cred("FIRST_AID_CPR", CPR, now, { expiresInDays: 250 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 400 })],
      training: trained(["ORIENTATION", "PSYCH_FIRST_AID_INTRO"], now),
      languages: ["en", "ar"],
      stats: { missionsCompleted: 6, hoursContributed: 40 },
    }),
    P({
      id: "r-ben",
      role: "TRAINED_VOLUNTEER",
      name: "Ben Carter",
      headline: "Roofer · fall-protection certified",
      locality: "Grandin Village",
      location: { lat: 37.2715, lng: -79.97 },
      maxTravelKm: 30,
      identityVerified: true,
      skills: ["ROOF_TARPING", "GENERAL_LABOR"],
      credentials: [cred("ROOF_FALL_PROTECTION", "Fall-protection competent-person course (external)", now, { expiresInDays: 420 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 480 })],
      training: trained(["ORIENTATION"], now),
      assets: [asset("r-ben", "LADDER", "32-ft extension ladder"), asset("r-ben", "TARPS", "Heavy-duty tarps", 6, { consumable: true })],
      stats: { missionsCompleted: 3, hoursContributed: 22 },
    }),
    P({
      id: "r-grace",
      role: "GENERAL_VOLUNTEER",
      name: "Grace Liu",
      headline: "University student volunteer",
      locality: "Blacksburg",
      location: { lat: 37.229, lng: -80.42 },
      maxTravelKm: 60,
      identityVerified: true,
      skills: ["GENERAL_LABOR"],
      credentials: [cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 700 })],
      training: trained(["ORIENTATION", "FLOOD_CLEANUP_SAFETY"], now),
      languages: ["en", "zh"],
      stats: { missionsCompleted: 0, hoursContributed: 0 },
    }),
    P({
      id: "r-kevin",
      role: "GENERAL_VOLUNTEER",
      name: "Kevin O'Neal",
      headline: "Flood cleanup crew lead",
      locality: "Vinton",
      location: { lat: 37.2835, lng: -79.902 },
      maxTravelKm: 25,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "FLOOD_CLEANUP"],
      credentials: [cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 350 })],
      training: trained(["ORIENTATION", "FLOOD_CLEANUP_SAFETY"], now),
      assets: [asset("r-kevin", "WET_VAC", "Wet/dry vac (16 gal)"), asset("r-kevin", "WATER_PUMP", "Submersible pump"), asset("r-kevin", "HAND_TOOLS", "Muck-out kit & respirators")],
      stats: { missionsCompleted: 5, hoursContributed: 36 },
    }),
    P({
      id: "r-maria",
      role: "GENERAL_VOLUNTEER",
      name: "Maria Santos",
      headline: "Food service · bilingual (ES/EN)",
      locality: "Salem",
      location: { lat: 37.29, lng: -80.06 },
      maxTravelKm: 30,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "FOOD_SERVICE", "DRIVING"],
      credentials: [cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 900 }), cred("FOOD_HANDLER", "Food handler certification (external)", now, { expiresInDays: 500 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 450 })],
      training: trained(["ORIENTATION"], now),
      languages: ["es", "en"],
      assets: [asset("r-maria", "PASSENGER_VEHICLE", "Sedan")],
      stats: { missionsCompleted: 4, hoursContributed: 26 },
    }),
    P({
      id: "r-ethan",
      role: "GENERAL_VOLUNTEER",
      name: "Ethan Brooks",
      headline: "New sign-up (spontaneous volunteer)",
      locality: "Downtown Roanoke",
      location: { lat: 37.2735, lng: -79.9395 },
      maxTravelKm: 20,
      identityVerified: false,
      skills: ["GENERAL_LABOR", "CHAINSAW_OPERATION"],
      credentials: [],
      assets: [asset("r-ethan", "CHAINSAW", "Chainsaw")],
      stats: { missionsCompleted: 0, hoursContributed: 0 },
    }),
    P({
      id: "r-hannah",
      role: "TRAINED_VOLUNTEER",
      name: "Hannah Pierce",
      headline: "CERT member",
      locality: "Cave Spring",
      location: { lat: 37.225, lng: -79.995 },
      maxTravelKm: 15,
      identityVerified: true,
      skills: ["GENERAL_LABOR", "FIRST_AID", "WELLNESS_VISITS"],
      credentials: [cred("CERT_BASIC", CERT, now), cred("FIRST_AID_CPR", CPR, now, { expiresInDays: 200 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 300 })],
      training: trained(["ORIENTATION", "PSYCH_FIRST_AID_INTRO"], now),
      availability: { status: "UNAVAILABLE", note: "own home damaged — standing down" },
      stats: { missionsCompleted: 8, hoursContributed: 52 },
    }),
    P({
      id: "r-omar",
      role: "TRAINED_VOLUNTEER",
      name: "Omar Haddad",
      headline: "Sawyer (credential renewal due)",
      locality: "Salem",
      location: { lat: 37.296, lng: -80.04 },
      maxTravelKm: 30,
      identityVerified: true,
      skills: ["CHAINSAW_OPERATION", "GENERAL_LABOR"],
      credentials: [
        cred("CHAINSAW_SAFETY", "Regional sawyer safety & operation course (Level 1)", now, { expiresInDays: -120, verifiedDaysAgo: 800 }),
        cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 200 }),
      ],
      training: trained(["ORIENTATION", "CHAINSAW_AWARENESS"], now),
      stats: { missionsCompleted: 4, hoursContributed: 30 },
    }),
    P({
      id: "r-lily",
      role: "GENERAL_VOLUNTEER",
      name: "Lily Tran",
      headline: "Battery-station courier",
      locality: "Raleigh Court",
      location: { lat: 37.262, lng: -79.98 },
      maxTravelKm: 25,
      identityVerified: true,
      skills: ["DRIVING", "GENERAL_LABOR"],
      credentials: [cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 1100 }), cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 600 })],
      training: trained(["ORIENTATION", "GENERATOR_CO_SAFETY"], now),
      assets: [asset("r-lily", "PORTABLE_BATTERY", "Portable battery station (2 kWh)", 2)],
      stats: { missionsCompleted: 3, hoursContributed: 15 },
    }),
    P({
      id: "r-bobby",
      role: "SKILLED_PROFESSIONAL",
      name: "Bobby Jenkins",
      headline: "Certified arborist",
      locality: "Daleville",
      location: { lat: 37.409, lng: -79.915 },
      maxTravelKm: 45,
      identityVerified: true,
      skills: ["CHAINSAW_OPERATION", "GENERAL_LABOR", "DRIVING"],
      credentials: [
        cred("CHAINSAW_SAFETY", "Certified arborist credential (external)", now, { expiresInDays: 800 }),
        cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 500 }),
        cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 700 }),
      ],
      training: trained(["ORIENTATION", "CHAINSAW_AWARENESS"], now),
      availability: { status: "LIMITED", note: "after 2 pm" },
      assets: [asset("r-bobby", "CHAINSAW", "Professional chainsaw"), asset("r-bobby", "PICKUP_TRUCK", "Crew truck"), asset("r-bobby", "TRAILER", "Chipper trailer")],
      stats: { missionsCompleted: 11, hoursContributed: 70 },
    }),
    P({
      id: "r-chloe",
      role: "GENERAL_VOLUNTEER",
      name: "Chloe Adams",
      headline: "Wellness visitor",
      locality: "Hollins",
      location: { lat: 37.344, lng: -79.938 },
      maxTravelKm: 20,
      identityVerified: true,
      skills: ["WELLNESS_VISITS", "GENERAL_LABOR"],
      credentials: [cred("BACKGROUND_CHECK", BG, now, { expiresInDays: 650 })],
      training: trained(["ORIENTATION", "PSYCH_FIRST_AID_INTRO"], now),
      stats: { missionsCompleted: 2, hoursContributed: 9 },
    }),
    P({
      id: "r-david",
      role: "GENERAL_VOLUNTEER",
      name: "David Nguyen",
      headline: "Truck & trailer",
      locality: "Christiansburg",
      location: { lat: 37.132, lng: -80.405 },
      maxTravelKm: 50,
      identityVerified: true,
      skills: ["DRIVING", "GENERAL_LABOR"],
      credentials: [cred("DRIVERS_LICENSE", DL, now, { expiresInDays: 400 })],
      training: trained(["ORIENTATION"], now),
      assets: [asset("r-david", "PICKUP_TRUCK", "Pickup truck"), asset("r-david", "TRAILER", "Flatbed trailer")],
      stats: { missionsCompleted: 1, hoursContributed: 6 },
    }),

    O({
      id: "o-blueridge",
      role: "BUSINESS",
      name: "Blue Ridge Landscaping",
      headline: "Local landscaping business · trucks, saws & crew",
      locality: "Cave Spring",
      location: { lat: 37.239, lng: -79.9905 },
      maxTravelKm: 30,
      identityVerified: true,
      credentials: [cred("BACKGROUND_CHECK", "Employer attestation — all field staff screened", now, { expiresInDays: 365 }), cred("DRIVERS_LICENSE", "Commercial fleet drivers (external)", now, { expiresInDays: 365 })],
      assets: [
        asset("o-blueridge", "PICKUP_TRUCK", "Crew pickup truck", 2),
        asset("o-blueridge", "CHAINSAW", "Chainsaw & PPE kit", 2),
        asset("o-blueridge", "TRAILER", "Dump trailer"),
        asset("o-blueridge", "HAND_TOOLS", "Rakes, loppers & tools", 4),
      ],
      stats: { missionsCompleted: 6, hoursContributed: 0 },
    }),
    O({
      id: "o-pantry",
      role: "NONPROFIT",
      name: "Star City Community Pantry",
      headline: "Food & water distribution",
      locality: "Downtown Roanoke",
      location: { lat: 37.2745, lng: -79.9435 },
      maxTravelKm: 40,
      identityVerified: true,
      credentials: [cred("BACKGROUND_CHECK", "Nonprofit attestation — delivery volunteers screened", now, { expiresInDays: 365 })],
      assets: [
        asset("o-pantry", "FOOD_SUPPLY", "Shelf-stable meals & infant formula", 600, { consumable: true }),
        asset("o-pantry", "WATER_SUPPLY", "Bottled drinking water (gal)", 900, { consumable: true }),
        asset("o-pantry", "REFRIGERATION", "Medication cooler with battery", 3),
      ],
      stats: { missionsCompleted: 22, hoursContributed: 0 },
    }),
    O({
      id: "o-shelter",
      role: "NONPROFIT",
      name: "Grace Fellowship Shelter",
      headline: "Faith-based emergency shelter · ADA accessible",
      locality: "Salem",
      location: { lat: 37.292, lng: -80.048 },
      maxTravelKm: 40,
      identityVerified: true,
      skills: ["SHELTER_OPERATIONS"],
      credentials: [cred("BACKGROUND_CHECK", "Nonprofit attestation — shelter staff screened", now, { expiresInDays: 365 })],
      accessibilitySupport: ["MOBILITY_ASSIST", "SENSORY_FRIENDLY"],
      assets: [asset("o-shelter", "SHELTER_BEDS", "Accessible shelter beds", 40, { accessible: true, consumable: true })],
      stats: { missionsCompleted: 14, hoursContributed: 0 },
    }),
    O({
      id: "o-access",
      role: "NONPROFIT",
      name: "Valley Access Rides",
      headline: "Wheelchair-accessible transportation",
      locality: "Downtown Roanoke",
      location: { lat: 37.28, lng: -79.955 },
      maxTravelKm: 40,
      identityVerified: true,
      credentials: [cred("BACKGROUND_CHECK", "Nonprofit attestation — drivers screened", now, { expiresInDays: 365 })],
      accessibilitySupport: ["WHEELCHAIR_TRANSPORT"],
      assets: [asset("o-access", "ACCESSIBLE_VAN", "Ramp-equipped accessible van", 2, { accessible: true })],
      stats: { missionsCompleted: 17, hoursContributed: 0 },
    }),
    O({
      id: "o-hardware",
      role: "BUSINESS",
      name: "Hometown Hardware of Vinton",
      headline: "Hardware store · equipment loans",
      locality: "Vinton",
      location: { lat: 37.2805, lng: -79.895 },
      maxTravelKm: 30,
      identityVerified: true,
      credentials: [cred("BACKGROUND_CHECK", "Employer attestation — delivery staff screened", now, { expiresInDays: 365 })],
      assets: [
        asset("o-hardware", "TARPS", "Heavy-duty tarps", 40, { consumable: true }),
        asset("o-hardware", "GENERATOR", "Portable generator (loan)", 3),
        asset("o-hardware", "WET_VAC", "Wet/dry vac (loan)", 4),
        asset("o-hardware", "WATER_PUMP", "Utility pump (loan)", 2),
        asset("o-hardware", "PORTABLE_BATTERY", "Battery power station (loan)", 4),
        asset("o-hardware", "HAND_TOOLS", "Cleanup tool kits", 10),
        asset("o-hardware", "LADDER", "Extension ladder (loan)", 2),
      ],
      stats: { missionsCompleted: 9, hoursContributed: 0 },
    }),
  ];
}

type Script = "none" | "propose" | "dispatch" | "in_progress" | "verified";

interface IncidentSeed {
  key: string;
  minutesAgo: number;
  source: Incident["source"];
  point: GeoPoint;
  label: string;
  locality: string;
  request: Omit<IntakeRequest, "accessibilityNeeds" | "immediateDanger"> & Partial<Pick<IntakeRequest, "accessibilityNeeds" | "immediateDanger">>;
  script: Script;
  /** Minutes after creation for each lifecycle step. */
  timing?: { propose?: number; dispatch?: number; start?: number; complete?: number; verify?: number };
  completionNote?: string;
  ackHandoffs?: boolean;
  /** Coordinator's choice of responder per slot (keeps the guided-demo team free). */
  overrides?: Record<string, string>;
  /** Navigator only: the resident got guidance and referrals and did not ask for a community mission. */
  guided?: boolean;
  /** Referral / handoff needs a coordinator later recorded as taken care of. */
  resolvedNote?: string;
}

export const INCIDENT_SEEDS: IncidentSeed[] = [
  {
    key: "charging",
    minutesAgo: 540,
    source: "PHONE_TRIAGE",
    point: { lat: 37.2828, lng: -79.8935 },
    label: "Senior apartments near the library, Vinton",
    locality: "Vinton",
    request: { text: "About a dozen of us in the senior apartments near the library have had no power since yesterday and our phones are dead. We can't call our families.", locationText: "Vinton", peopleAffected: 12 },
    script: "verified",
    timing: { propose: 15, dispatch: 25, start: 60, complete: 150, verify: 170 },
    completionNote: "Battery station set up in the community room; residents charging phones.",
  },
  {
    key: "supplies",
    minutesAgo: 480,
    source: "RESIDENT_APP",
    point: { lat: 37.2772, lng: -79.8841 },
    label: "East Vinton",
    locality: "Vinton",
    request: { text: "We have a baby and we're almost out of formula and drinking water. Our road is washed out so we can't drive to the store.", locationText: "Vinton", peopleAffected: 3 },
    script: "verified",
    timing: { propose: 10, dispatch: 20, start: 55, complete: 80, verify: 95 },
    completionNote: "Delivered formula, 9 gallons of water and meals. Family is OK.",
  },
  {
    key: "shelter",
    minutesAgo: 420,
    source: "RESIDENT_APP",
    point: { lat: 37.2966, lng: -80.0612 },
    label: "Riverside apartments, Salem",
    locality: "Salem",
    request: { text: "Water came into our apartment on the first floor and management told everyone to leave. Family of 5 with two young kids — we need somewhere to stay tonight and don't know if FEMA can help.", locationText: "Salem" },
    script: "none",
    guided: true,
    resolvedNote: "Family checked in at Grace Fellowship Shelter after the referral.",
  },
  {
    key: "muckout",
    minutesAgo: 330,
    source: "RESIDENT_APP",
    point: { lat: 37.2508, lng: -79.9102 },
    label: "Riverdale, Roanoke",
    locality: "Roanoke",
    request: { text: "Our first floor took in two feet of water. The carpet and drywall are soaked and it's starting to smell like mold. We need help tearing out the wet drywall.", locationText: "Riverdale, Roanoke", peopleAffected: 3 },
    script: "in_progress",
    timing: { propose: 20, dispatch: 40, start: 90 },
  },
  {
    key: "powerline",
    minutesAgo: 240,
    source: "RESIDENT_APP",
    point: { lat: 37.2592, lng: -79.9551 },
    label: "Wasena, Roanoke",
    locality: "Roanoke",
    request: { text: "A big oak tree came down across our street and took the power lines with it. The wires are lying in the road and in our front yard. Nobody is hurt.", locationText: "Wasena, Roanoke", peopleAffected: 4 },
    script: "none",
    ackHandoffs: true,
  },
  {
    key: "garage",
    minutesAgo: 225,
    source: "RESIDENT_APP",
    point: { lat: 37.2881, lng: -80.0489 },
    label: "Salem",
    locality: "Salem",
    request: { text: "The flood undermined the back of our garage and the wall is leaning badly. We want to get our tools and my dad's wheelchair out of there.", locationText: "Salem", peopleAffected: 3 },
    script: "none",
    ackHandoffs: true,
  },
  {
    key: "bentmtn",
    minutesAgo: 210,
    source: "PHONE_TRIAGE",
    point: { lat: 37.1583, lng: -80.1178 },
    label: "Bent Mountain, Roanoke County",
    locality: "Roanoke County",
    request: { text: "Several trees are down across our gravel lane and we can't get out to the main road. No power lines are down as far as we can see. Two of us here, both okay.", locationText: "Bent Mountain" },
    script: "none",
  },
  {
    key: "wellness",
    minutesAgo: 190,
    source: "RESIDENT_APP",
    point: { lat: 37.3012, lng: -79.9478 },
    label: "Williamson Road, Roanoke",
    locality: "Roanoke",
    request: { text: "My aunt is 84 and lives alone off Williamson Road. Her phone goes straight to voicemail and nobody has heard from her since the storm. Can someone check on her?", locationText: "Williamson Road, Roanoke", peopleAffected: 1, reporterRelation: "FAMILY" },
    script: "none",
  },
  {
    key: "oxygen",
    minutesAgo: 160,
    source: "PHONE_TRIAGE",
    point: { lat: 37.2349, lng: -79.9262 },
    label: "Garden City, Roanoke",
    locality: "Roanoke",
    request: { text: "Power has been out since last night. My husband is on an oxygen concentrator and his backup tank is getting low. Roads around us are underwater.", locationText: "Garden City, Roanoke", peopleAffected: 2 },
    script: "dispatch",
    timing: { propose: 8, dispatch: 14 },
  },
  {
    key: "hazmat",
    minutesAgo: 140,
    source: "RESIDENT_APP",
    point: { lat: 37.2893, lng: -79.9236 },
    label: "Tinker Creek, Roanoke",
    locality: "Roanoke",
    request: { text: "There are several metal drums floating in Tinker Creek behind the auto shop and a strong fuel smell along the bank.", locationText: "Tinker Creek, Roanoke", peopleAffected: 1, reporterRelation: "OTHER" },
    script: "none",
    ackHandoffs: true,
  },
  {
    key: "roof",
    minutesAgo: 125,
    source: "RESIDENT_APP",
    point: { lat: 37.2688, lng: -79.9731 },
    label: "Grandin Village, Roanoke",
    locality: "Roanoke",
    request: { text: "A large limb punched a hole in our roof and rain is coming in over the kids' bedroom. We have buckets out but need a tarp on the roof before tonight's rain.", locationText: "Grandin Village, Roanoke", peopleAffected: 4 },
    script: "none",
  },
  {
    key: "gas",
    minutesAgo: 100,
    source: "RESIDENT_APP",
    point: { lat: 37.2842, lng: -79.9001 },
    label: "Vinton",
    locality: "Vinton",
    request: { text: "The storm knocked a tree into the side of our house and now we smell gas near the meter. We are standing outside with the kids.", locationText: "Vinton", peopleAffected: 4 },
    script: "none",
    ackHandoffs: true,
  },
  {
    key: "dialysis",
    minutesAgo: 90,
    source: "RESIDENT_APP",
    point: { lat: 37.2551, lng: -79.9311 },
    label: "Southeast Roanoke",
    locality: "Roanoke",
    request: { text: "I use a wheelchair and have dialysis tomorrow morning at 7. My accessible van was flooded and I have no way to get there.", locationText: "Southeast Roanoke", peopleAffected: 1 },
    script: "none",
  },
  {
    key: "belongings",
    minutesAgo: 70,
    source: "RESIDENT_APP",
    point: { lat: 37.2372, lng: -79.9198 },
    label: "Garden City, Roanoke",
    locality: "Roanoke",
    request: {
      text: "Water got into our basement and we need help carrying our furniture and boxes upstairs before it gets worse. My mother only speaks Spanish.",
      locationText: "Garden City, Roanoke",
      peopleAffected: 3,
      language: "es",
      reporterRelation: "FAMILY",
    },
    script: "none",
  },
  {
    key: "insulin",
    minutesAgo: 55,
    source: "RESIDENT_APP",
    point: { lat: 37.3372, lng: -79.9392 },
    label: "Hollins, Roanoke County",
    locality: "Roanoke County",
    request: { text: "Power has been out for two days and I need to keep my insulin cold. The ice in the cooler is almost gone.", locationText: "Hollins", peopleAffected: 1 },
    script: "propose",
    timing: { propose: 12 },
  },
  {
    key: "swift",
    minutesAgo: 38,
    source: "PHONE_TRIAGE",
    point: { lat: 37.2489, lng: -79.9022 },
    label: "Riverland Road, Roanoke",
    locality: "Roanoke",
    request: { text: "Caller reports a car stalled in flood water on the road by the river with the driver still inside. Water is rising fast.", locationText: "Riverland Road, Roanoke", peopleAffected: 1, immediateDanger: true, reporterRelation: "OTHER" },
    script: "none",
    ackHandoffs: true,
  },
  {
    key: "debris",
    minutesAgo: 205,
    source: "RESIDENT_APP",
    point: { lat: 37.2418, lng: -79.9296 },
    label: "Garden City, Roanoke",
    locality: "Roanoke",
    request: { text: "Storm debris is piled across our driveway and front yard — fencing, shingles and yard waste. We need help hauling it away so we can get the car out.", locationText: "Garden City, Roanoke", peopleAffected: 2 },
    script: "in_progress",
    timing: { propose: 10, dispatch: 18, start: 50 },
    overrides: { haul: "r-tom" },
  },
  {
    key: "generator",
    minutesAgo: 175,
    source: "COORDINATOR",
    point: { lat: 37.2809, lng: -79.8961 },
    label: "Vinton community center",
    locality: "Vinton",
    request: { text: "The Vinton community center lost power and it is the neighborhood cooling site. A donated generator arrived — we need a licensed electrician to connect it to the building's transfer switch safely.", locationText: "Vinton", peopleAffected: 40 },
    script: "none",
  },
  {
    key: "report-riverland",
    minutesAgo: 115,
    source: "RESIDENT_APP",
    point: { lat: 37.2493, lng: -79.905 },
    label: "Riverland Rd, Roanoke",
    locality: "Roanoke",
    request: { text: "Heads up — water is over the road on Riverland Rd near the river and it looks too deep to drive through. I turned around, no help needed.", locationText: "Riverland Road, Roanoke", peopleAffected: 1, reporterRelation: "OTHER" },
    script: "none",
  },
  {
    key: "medical",
    minutesAgo: 22,
    source: "RESIDENT_APP",
    point: { lat: 37.2588, lng: -79.9246 },
    label: "Southeast Roanoke",
    locality: "Roanoke",
    request: { text: "My dad fell on the wet stairs during the storm, hit his head and now he's confused. Please send help.", locationText: "Southeast Roanoke", peopleAffected: 1, reporterRelation: "FAMILY" },
    script: "none",
  },
];

export interface World {
  incidents: Incident[];
  missions: Mission[];
  responders: Responder[];
  events: OperationalEvent[];
  cameras: CameraResource[];
}

/**
 * Build the complete seeded world for a workspace by replaying the scenario through the real engine.
 * The LIVE workspace (/live) is never seeded: no fictional responders, incidents, missions,
 * conditions or cameras can mix with real feed data.
 */
export function buildSeedWorld(workspaceId: string, now = new Date()): World {
  if (workspaceMode(workspaceId) === "LIVE") return { incidents: [], missions: [], responders: [], events: [], cameras: [] };
  let responders: Responder[] = seedResponders(now).map((r) => ({ ...r, workspaceId }));
  const incidents: Incident[] = [];
  const missions: Mission[] = [];
  let missionNumber = SCENARIO.firstMissionNumber;
  const coord = SCENARIO.coordinator.name;
  const at = (created: Date, minutes = 0) => new Date(created.getTime() + minutes * 6e4);
  const events = baselineEvents(workspaceId, now);
  const { restrictions, slowdowns } = restrictionsFrom(correlate(events, now));

  // Oldest first, so lifecycle ordering is realistic.
  const seeds = [...INCIDENT_SEEDS].sort((a, b) => b.minutesAgo - a.minutesAgo);
  seeds.forEach((s, i) => {
    const created = new Date(now.getTime() - s.minutesAgo * 6e4);
    const request: IntakeRequest = { accessibilityNeeds: [], immediateDanger: false, ...s.request };
    const proposal = interpretLocally(request);
    let incident = buildIncident({
      id: `inc-${s.key}`,
      number: `INC-${SCENARIO.firstIncidentNumber + i}`,
      workspaceId,
      source: s.source,
      request,
      location: s.point,
      locality: s.locality,
      locationLabel: s.label,
      interpretation: { provider: "local-rules", latencyMs: 3, proposal },
      raw: proposal,
      now: created,
    });

    if (s.ackHandoffs) {
      // The coordinator phoned each agency (outside CoORDINATE) and recorded it.
      for (const h of incident.handoffs) {
        incident = recordHandoffContact(incident, h.target, coord, "Called the agency's emergency line.", at(created, 3));
        incident = recordHandoffAcknowledgement(incident, h.target, coord, "", at(created, 4));
      }
    }
    if (incident.status === "LOGGED") events.push(communityReportFromIncident(incident, "SCENARIO"));

    // Navigator: the resident asked for coordinated help with every community need they stated (N-15).
    const offered = incident.needs.filter((n) => n.status === "HELP_AVAILABLE" && n.origin === "STATED").map((n) => n.id);
    if (!s.guided && offered.length && incident.status === "GUIDED") {
      incident = requestCommunityHelp(incident, offered, request.reporterName ?? (s.source === "PHONE_TRIAGE" ? coord : "Resident"), s.source === "PHONE_TRIAGE" || s.source === "COORDINATOR" ? "coordinator" : "resident", at(created, 1));
    }
    if (s.resolvedNote) {
      for (const n of incident.needs.filter((x) => x.path === "SERVICE_REFERRAL" && x.type === "SHELTER")) incident = resolveNeedRecord(incident, n.id, coord, s.resolvedNote, at(created, 90));
    }

    if (s.script !== "none") {
      for (const adv of incident.advisories) incident = acknowledgeAdvisory(incident, adv.id, coord, at(created, (s.timing?.propose ?? 5) - 1));
      const proposed = proposeTeam({
        incident,
        responders,
        missions,
        missionNumber: missionNumber++,
        overrides: s.overrides,
        actor: s.overrides ? coord : "engine",
        now: at(created, s.timing?.propose ?? 5),
      });
      incident = proposed.incident;
      let mission = proposed.mission;
      if (s.script !== "propose") {
        const dispatchedAt = at(created, s.timing?.dispatch ?? 10);
        const d = dispatch({ incident, mission, responders, missions, actorName: coord, now: dispatchedAt });
        incident = d.incident;
        mission = { ...d.mission, briefing: { text: withSafety(templateBriefing(incident, d.mission, responders), incident), provider: "local-rules" } };
        const ends = missionEndpoints(incident, leadResponder(mission, responders));
        const route = ends && planDeterministicRoute({ ...ends, restrictions, slowdowns, version: 1, now: dispatchedAt });
        if (route) ({ incident, mission } = attachRoute(incident, mission, route, dispatchedAt));
        if (s.script === "in_progress" || s.script === "verified") {
          const lead = responders.find((r) => r.id === mission.assignments.find((a) => !a.assetId)?.responderId)?.name ?? "Team lead";
          const st = startMission(incident, mission, lead, at(created, s.timing?.start ?? 30));
          incident = st.incident;
          mission = st.mission;
          if (s.script === "verified") {
            const c = completeMission(incident, mission, lead, s.completionNote ?? "Done.", at(created, s.timing?.complete ?? 60));
            const v = verifyMission({ incident: c.incident, mission: c.mission, responders, by: coord, byRole: "coordinator", note: "Confirmed with resident by phone.", now: at(created, s.timing?.verify ?? 70) });
            incident = v.incident;
            mission = v.mission;
            const updated = new Map(v.responders.map((r) => [r.id, r]));
            responders = responders.map((r) => updated.get(r.id) ?? r);
          }
        }
      }
      missions.push(mission);
    }
    incidents.push(incident);
  });

  return { incidents, missions, responders, events, cameras: baselineCameras(workspaceId, now) };
}
