/**
 * Situational-awareness domain: operational events from external sources,
 * provenance, cameras, routes, mission reassessment and provider health.
 *
 * Kept separate from the incident/matching model on purpose:
 *  - an INCIDENT is a community need that may become a mission;
 *  - an OPERATIONAL EVENT is a condition in the environment (closure, warning,
 *    observation) that constrains missions but never creates one by itself.
 */

/** GeoJSON geometry with [lng, lat] positions (RFC 7946 order). */
export type Position = [number, number];
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export const OPERATIONAL_EVENT_TYPES = [
  "TRAFFIC_CRASH",
  "ROAD_CLOSURE",
  "ROAD_HAZARD",
  "ROAD_WORK",
  "CONGESTION",
  "FLOODING",
  "FLASH_FLOOD_WARNING",
  "TORNADO_WARNING",
  "SEVERE_THUNDERSTORM_WARNING",
  "HIGH_WIND",
  "WEATHER_ADVISORY",
  "FIRE",
  "EVACUATION",
  "SHELTER_IN_PLACE",
  "UTILITY_OUTAGE",
  "HAZMAT",
  "PUBLIC_SAFETY_INCIDENT",
  "CAMERA_OBSERVATION",
  "COMMUNITY_REPORT",
  "NEWS_REPORT",
] as const;
export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

export type EventCategory = "TRAFFIC" | "WEATHER" | "ALERT" | "PUBLIC_SAFETY" | "CAMERA" | "COMMUNITY" | "NEWS" | "INFRASTRUCTURE";

export const SOURCE_TYPES = [
  "NWS",
  "IPAWS",
  "AZURE_MAPS_TRAFFIC",
  "VIRGINIA_511",
  "PUBLIC_CAD",
  "PUBLIC_CAMERA",
  "PRIVATE_CAMERA",
  "NEWS",
  "COMMUNITY",
  "COORDINATOR",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Highest to lowest. Order matters — see engine/correlate.ts. */
export const AUTHORITY_LEVELS = [
  "AUTHORITATIVE_ALERT",
  "AUTHORITATIVE_OPERATIONAL_DATA",
  "VERIFIED_PARTNER",
  "COORDINATOR_CONFIRMED",
  "COMMUNITY_REPORT",
  "MEDIA_REPORT",
  "MACHINE_DERIVED_OBSERVATION",
  "UNVERIFIED_OPEN_SOURCE",
] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export type VerificationStatus = "AUTHORITATIVE" | "VERIFIED" | "CORROBORATED" | "UNVERIFIED" | "DISPUTED" | "STALE";
export type Severity = "EXTREME" | "SEVERE" | "MODERATE" | "MINOR" | "UNKNOWN";

/** What a condition does to operations. Effects are proposals until the correlation engine deems them actionable. */
export type EffectKind =
  | "BLOCKS_ROAD" // no route may pass within the effect radius
  | "SLOWS_ROAD" // adds delay, never blocks
  | "HOLD_ALL_ACTIVITY" // e.g. tornado warning: shelter, do not travel
  | "HOLD_OUTDOOR_WORK" // e.g. severe thunderstorm / high wind: stop saws, roofs, debris
  | "AVOID_AREA" // route around the area (e.g. flash-flood polygon)
  | "NO_CIVILIAN_ENTRY" // fire, hazmat, evacuation: civilians must not enter
  | "ADVISORY"; // informational only

export interface OperationalEffect {
  kind: EffectKind;
  /** For point/line events: distance within which roads/sites are affected. */
  radiusM?: number;
  delayMinutes?: number;
}

export type DataMode = "LIVE" | "SCENARIO";

export interface CameraObservationDetail {
  cameraId: string;
  cameraName: string;
  observationType: "ROAD_BLOCKED" | "ROAD_CLEAR" | "STANDING_WATER" | "DEBRIS_PRESENT" | "HEAVY_CONGESTION" | "SMOKE_VISIBLE" | "ACCESS_OBSTRUCTED" | "ACCESS_CLEAR" | "LARGE_QUEUE" | "UNKNOWN";
  machineGenerated: boolean;
  humanVerified: boolean;
  /** Temporary frame reference; raw media is not retained by default. */
  mediaReference?: string;
}

export interface OperationalEvent {
  id: string;
  /** Workspace for scenario events; "live" for events from live feeds. */
  workspaceId: string;
  mode: DataMode;
  simulated: boolean;
  type: OperationalEventType;
  category: EventCategory;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  originalId?: string;
  authorityLevel: AuthorityLevel;
  verificationStatus: VerificationStatus;
  title: string;
  description?: string;
  roadName?: string;
  geometry: Geometry;
  severity?: Severity;
  urgency?: string;
  certainty?: string;
  eventTime?: string;
  startsAt?: string;
  expiresAt?: string;
  fetchedAt: string;
  confidence?: number;
  effects: OperationalEffect[];
  camera?: CameraObservationDetail;
  /** Public-safety feeds: respect the source's redaction. */
  publicDetailLevel?: "FULL" | "REDACTED" | "AREA_ONLY";
  latencySeconds?: number;
  /** Set when a coordinator confirms or disputes the event. */
  coordinatorReview?: { status: "CONFIRMED" | "DISPUTED"; by: string; at: string; note?: string };
  /** The CoORDINATE incident this event came from or documents (community reports, opt-in camera snapshots). */
  incidentId?: string;
  /** Live feeds only: where the item came from and when (see src/live/ingest.ts). */
  provenance?: EventProvenance;
  /** Live feeds only: the upstream payload, kept for audit. Never sent to browsers. */
  raw?: unknown;
}

/**
 * Provenance of a live feed item. `source` + `sourceId` identify it upstream and are the
 * deduplication key: a re-fetched item replaces its earlier copy instead of adding one.
 */
export interface EventProvenance {
  /** Provider id (e.g. "nws", "va511"). */
  source: string;
  /** The item's id in the upstream feed. */
  sourceId: string;
  sourceUrl?: string;
  /** When the upstream source last issued/updated the item, if it says. */
  sourceUpdatedAt?: string;
  /** First time CoORDINATE stored this version of the item. */
  ingestedAt: string;
  /** Last successful fetch that still listed the item. */
  observedAt: string;
  expiresAt?: string;
  /** sha256 of the upstream payload: detects upstream changes and supports audit. */
  rawHash: string;
  /** "cleared" once the source stops listing the item. */
  status: "active" | "cleared" | "unknown";
  clearedAt?: string;
}

/** An actionable effect placed at the geometry of the member that proposed it. */
export interface EffectArea {
  eventId: string;
  kind: EffectKind;
  geometry: Geometry;
  radiusM?: number;
  delayMinutes?: number;
}

/** Result of multi-source correlation. Members keep their own provenance. */
export interface EventCluster {
  id: string;
  title: string;
  type: OperationalEventType;
  memberIds: string[];
  primaryId: string;
  sourceTypes: SourceType[];
  status: VerificationStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Effects the rules treat as actionable (authoritative or corroborated) — one per kind, for display. */
  actionableEffects: OperationalEffect[];
  /** Every actionable effect at its proposing member's own geometry — what routing and holds use. */
  actionableAreas: EffectArea[];
  /** Effects proposed but not actionable, and why. */
  pendingEffects: { effect: OperationalEffect; reason: string }[];
  /** Display geometry: union of member areas, or the strongest actionable member's geometry. */
  geometry: Geometry;
  expiresAt?: string;
  evidence: EvidenceItem[];
}

export interface EvidenceItem {
  eventId: string;
  sourceName: string;
  sourceType: SourceType;
  authorityLevel: AuthorityLevel;
  label: string;
  observedAt: string;
  expiresAt?: string;
  simulated: boolean;
  stale: boolean;
}

/* ------------------------------------------------------------------ */
/* Cameras (evidence sources, not surveillance)                        */
/* ------------------------------------------------------------------ */

export type CameraSourceType =
  | "PUBLIC_TRAFFIC_CAMERA"
  | "PUBLIC_INFRASTRUCTURE_CAMERA"
  | "USER_AUTHORIZED_RING_CAMERA"
  | "ORGANIZATION_AUTHORIZED_CAMERA"
  | "RESPONDER_SHARED_CAMERA"
  | "USER_UPLOADED_MEDIA";

export type SharingScope = "MOTION_METADATA_ONLY" | "CURRENT_SNAPSHOT" | "EMERGENCY_SNAPSHOTS_ONLY" | "LIVE_VIEW_EXPLICIT" | "DISABLED";

export interface CameraResource {
  id: string;
  workspaceId: string;
  mode: DataMode;
  simulated: boolean;
  name: string;
  sourceType: CameraSourceType;
  provider: string;
  location: { lat: number; lng: number };
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  snapshotUrl?: string;
  /** Private cameras only: owner consent. */
  consent?: {
    ownerLabel: string;
    scope: SharingScope;
    grantedAt: string;
    expiresAt?: string;
    revokedAt?: string;
    purpose: string;
  };
  accessLog: { at: string; action: string; by: string }[];
}

/* ------------------------------------------------------------------ */
/* Routing & reassessment                                               */
/* ------------------------------------------------------------------ */

export interface RoutePlan {
  version: number;
  provider: "demo-road-graph" | "azure-maps" | "straight-line-estimate";
  origin: { lat: number; lng: number; label: string };
  destination: { lat: number; lng: number; label: string };
  path: Position[];
  roads: string[];
  distanceKm: number;
  etaMinutes: number;
  computedAt: string;
  /** Conditions the route was planned around. */
  avoided: { clusterId: string; title: string; reason: string }[];
  /** Deliberately modest wording — the system never claims a route is safe. */
  statement: string;
}

export type ReassessmentOutcome = "CONTINUE" | "REROUTE" | "HOLD" | "RETURN_TO_SAFE_LOCATION" | "ESCALATE";

export interface DecisionRecord {
  id: string;
  decisionType: ReassessmentOutcome | "RESUME" | "ROUTE_PLANNED" | "ROUTE_ACKNOWLEDGED";
  createdAt: string;
  rulesApplied: string[];
  clusterIds: string[];
  result: string;
  explanation: string;
  evidence: EvidenceItem[];
  by: "rules" | string;
  humanOverride?: { by: string; reason: string };
}

export interface MissionHold {
  ruleId: string;
  reason: string;
  since: string;
  clusterIds: string[];
  evidence: EvidenceItem[];
  expiresAt?: string;
  /** The condition no longer applies; a coordinator may resume. */
  conditionCleared?: boolean;
  instruction: string;
  /** The household served is vulnerable: what the coordinator should do while the team is held. */
  welfareNote?: string;
}

/* ------------------------------------------------------------------ */
/* Provider health                                                      */
/* ------------------------------------------------------------------ */

export type ProviderState =
  | "LIVE"
  | "LIVE_DELAYED"
  | "CONNECTED"
  | "SIMULATED"
  | "STALE"
  | "DEGRADED"
  | "OFFLINE"
  | "NOT_CONFIGURED"
  | "PARTNER_REQUIRED"
  /** Configured but not polled yet — no claim about connectivity. */
  | "PENDING";

export interface ProviderHealth {
  id: string;
  name: string;
  category: "AI" | "MAPS" | "DATA" | "TRAFFIC" | "WEATHER" | "ALERTS" | "TRANSPORTATION" | "CAMERAS" | "PUBLIC_SAFETY" | "NEWS" | "REALTIME";
  state: ProviderState;
  detail: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  itemCount?: number;
}
