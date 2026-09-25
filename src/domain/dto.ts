import type {
  AssetType,
  DispatchCheck,
  AvailabilityStatus,
  GeoPoint,
  Hazard,
  Incident,
  IncidentCategory,
  IncidentStatus,
  InterpreterProvider,
  Mission,
  MissionStatus,
  NeedType,
  PriorityLevel,
  ResolutionPath,
  Responder,
  Role,
  SlotMatch,
  TriageLevel,
  Vulnerability,
} from "./types";

import type { AssistanceService } from "./assistance";
import type { CameraResource, DataMode, DecisionRecord, EventCategory, EventCluster, EventProvenance, MissionHold, OperationalEvent, ProviderHealth, RoutePlan } from "./ops";

/** API data-transfer shapes shared by route handlers and client components. */

export type DisplayStatus = IncidentStatus | "AWAITING_RESOURCES";

export interface IncidentSummary {
  id: string;
  number: string;
  createdAt: string;
  status: IncidentStatus;
  displayStatus: DisplayStatus;
  priority: PriorityLevel;
  priorityScore: number;
  triage: TriageLevel;
  category: IncidentCategory;
  summary: string;
  locality: string;
  locationLabel: string;
  location: GeoPoint;
  peopleAffected: number;
  needs: NeedType[];
  /** Resolution paths across the incident's needs (navigator). */
  paths: ResolutionPath[];
  /** The resident (or a coordinator for them) asked for coordinated community help. */
  helpRequested: boolean;
  hazards: Hazard[];
  vulnerabilities: Vulnerability[];
  requiredAssets: AssetType[];
  requiredRoles: string[];
  unfillableRoles: string[];
  pendingAdvisories: number;
  missionCode?: string;
  missionStatus?: MissionStatus;
  missionTitle?: string;
}

export interface ResponderMarker {
  id: string;
  name: string;
  kind: Responder["kind"];
  role: Role;
  location: GeoPoint;
  locality: string;
  state: "AVAILABLE" | "LIMITED" | "DEPLOYED" | "UNAVAILABLE" | "UNVERIFIED";
  missionCode?: string;
}

export interface Kpis {
  peopleHelped: number;
  peopleWaiting: number;
  volunteersDeployed: number;
  volunteersReady: number;
  organizations: number;
  /** Professional escalations the rules recommended. */
  escalationsRecommended: number;
  /** …of which a coordinator recorded making contact (outside CoORDINATE). */
  escalationsContacted: number;
  avgMinutesToDispatch: number | null;
  /** Needs by resolution path — most are resolved without a volunteer mission. */
  needsByPath: Record<ResolutionPath, number>;
  needsTotal: number;
  needsResolved: number;
  volunteerHours: number;
  estimatedValueUsd: number;
}

export interface ProviderStatus {
  ai: { provider: InterpreterProvider; model?: string };
  data: "cosmos" | "memory";
  maps: "azure-maps" | "openstreetmap";
  realtime: "azure-web-pubsub" | "polling";
  workspace: string;
  operation: string;
}

export interface Snapshot {
  generatedAt: string;
  operation: string;
  counts: Record<DisplayStatus, number>;
  incidents: IncidentSummary[];
  responders: ResponderMarker[];
  kpis: Kpis;
  gaps: { role: string; incidents: number }[];
}

export interface ResponderLite {
  id: string;
  name: string;
  kind: Responder["kind"];
  role: Role;
  headline: string;
  locality: string;
  location: GeoPoint;
  availability: AvailabilityStatus;
  readinessLevel: number;
  readinessName: string;
}

/** A directory entry as recommended in this workspace, with eligibility conditions not met right now. */
export type ServiceView = AssistanceService & { pending: string[] };

export interface IncidentDetail {
  incident: Incident;
  /** Navigator result: safety-first lines and the trusted services referenced by the needs. */
  navigator: {
    immediatePriority: string[];
    services: Record<string, ServiceView>;
    /** Household considerations the navigator took into account, with the words that showed them. */
    considerations: { vulnerability: Vulnerability; phrase?: string; source: "TEXT" | "FORM" | "AI" }[];
  };
  mission: Mission | null;
  matches: SlotMatch[];
  responders: Record<string, ResponderLite>;
  displayStatus: DisplayStatus;
  /** Dry-run of the dispatch gate for a proposed mission (includes operational checks). */
  dispatchPreview: { ok: boolean; partialOk?: boolean; checks: DispatchCheck[] } | null;
  /** The route the planner would use if dispatched now. */
  routePreview: RoutePlan | null;
  /** Owner-authorized cameras at this address (coordinators only). */
  optInCameras: { id: string; name: string; active: boolean; scope: string; purpose: string; expiresAt?: string }[];
  /** Operational evidence linked to this incident. */
  evidence: {
    clusterId: string;
    title: string;
    status: EventCluster["status"];
    items: EventCluster["evidence"];
    media: { eventId: string; url: string; label: string; humanVerified: boolean }[];
  }[];
}

export interface VolunteerView {
  responder: Responder;
  readiness: { level: number; name: string; next?: string };
  activeMission: { mission: Mission; incident: IncidentSummary; briefing?: string; role: string; teammates: { name: string; role: string }[] } | null;
  proposedMissions: { mission: Mission; incident: IncidentSummary; role: string }[];
  eligible: { incident: IncidentSummary; roles: string[]; distanceKm: number; score: number; offered: boolean }[];
  hiddenCount: number;
  unlocks: { credential: string; incidents: number }[];
  completed: { mission: Mission; incident: IncidentSummary; role: string }[];
}

/* ------------------------------------------------------------------ */
/* Common operational picture                                          */
/* ------------------------------------------------------------------ */

export interface OpsMissionView {
  id: string;
  code: string;
  title: string;
  incidentId: string;
  incidentNumber: string;
  status: MissionStatus;
  locationLabel: string;
  location: GeoPoint;
  exposure: "OUTDOOR" | "INDOOR";
  lead?: { id: string; name: string };
  route?: RoutePlan;
  previousRoute?: RoutePlan;
  hold?: MissionHold;
  heldFrom?: MissionStatus;
  decisions: DecisionRecord[];
}

export interface ClusterView extends EventCluster {
  category: EventCategory;
  mode: DataMode;
  simulated: boolean;
  /** Every member is stale; shown but never actionable. */
  stale: boolean;
  publicDetailLevel?: OperationalEvent["publicDetailLevel"];
  latencySeconds?: number;
  roadName?: string;
  incidentIds: string[];
  review?: OperationalEvent["coordinatorReview"];
}

export interface CameraView {
  id: string;
  name: string;
  sourceType: CameraResource["sourceType"];
  provider: string;
  location: GeoPoint;
  status: CameraResource["status"];
  simulated: boolean;
  snapshotUrl?: string;
  /** Private cameras: consent summary (coordinator and owner only). */
  consent?: { ownerLabel: string; scope: string; purpose: string; expiresAt?: string; revoked: boolean; active: boolean };
  accessLog?: CameraResource["accessLog"];
  latestObservation?: { at: string; label: string; eventId: string };
}

export interface ProviderRow extends ProviderHealth {
  group: "LIVE_FEED" | "SERVICE" | "SCENARIO";
  tier?: 1 | 2 | 3;
  describes?: string;
}

export interface ReassessChange {
  missionId: string;
  missionCode: string;
  incidentId: string;
  status: MissionStatus;
  message: string;
}

export interface OpsView {
  mode: DataMode;
  generatedAt: string;
  clusters: ClusterView[];
  cameras: CameraView[];
  missions: OpsMissionView[];
  providers: ProviderRow[];
  injections?: { id: string; label: string; detail: string }[];
  summary: { actionable: number; pendingReview: number; held: number; rerouting: number; restrictions: number; stale: number };
  changes?: ReassessChange[];
}

/** Health of one live source, in the four states /live shows (plus not-configured/pending). */
export type SourceHealthLevel = "healthy" | "degraded" | "stale" | "offline" | "unavailable" | "pending";

export function sourceHealthLevel(state: ProviderHealth["state"]): SourceHealthLevel {
  switch (state) {
    case "LIVE":
    case "LIVE_DELAYED":
    case "CONNECTED":
      return "healthy";
    case "DEGRADED":
      return "degraded";
    case "STALE":
      return "stale";
    case "OFFLINE":
      return "offline";
    case "PENDING":
      return "pending";
    default:
      return "unavailable";
  }
}

/** One live feed item with its provenance, as /live lists it. */
export interface LiveEventRow {
  id: string;
  title: string;
  description?: string;
  type: OperationalEvent["type"];
  category: EventCategory;
  severity?: OperationalEvent["severity"];
  authorityLevel: OperationalEvent["authorityLevel"];
  /** Supplemental sources (news) are intelligence, never an authoritative incident. */
  supplemental: boolean;
  sourceName: string;
  provenance: EventProvenance;
  startsAt?: string;
  roadName?: string;
  /** Its source's health right now: data from a stale/offline source is labelled, never shown as current. */
  sourceHealth: SourceHealthLevel;
  current: boolean;
}

/** /live: real Virginia feeds only. */
export interface LiveView extends OpsView {
  mode: "LIVE";
  events: LiveEventRow[];
  sources: (ProviderRow & { level: SourceHealthLevel })[];
  /** Most recent successful fetch across healthy event sources. */
  lastUpdatedAt?: string;
  /** Web PubSub is pushing changes to this page. */
  realtime: boolean;
}

/** Public hazard map: only actionable conditions, no people, no incident links. */
export interface PublicHazard {
  id: string;
  title: string;
  type: OperationalEvent["type"];
  category: EventCategory;
  geometry: OperationalEvent["geometry"];
  status: EventCluster["status"];
  sources: string[];
  effects: string[];
  expiresAt?: string;
  simulated: boolean;
}
