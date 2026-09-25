import type { Geometry } from "./ops";

/**
 * Trusted Assistance Directory model. Shaped after the Open Referral Human
 * Services Data Specification (organization → service → contact / eligibility /
 * service area), trimmed to what the navigator needs.
 */

export const SERVICE_TYPES = [
  "EMERGENCY_SERVICES",
  "DISASTER_ASSISTANCE",
  "RECOVERY_LOANS",
  "EMERGENCY_MANAGEMENT",
  "SHELTER",
  "FOOD",
  "WATER",
  "CHARGING",
  "TRANSPORTATION",
  "UTILITY_OUTAGE",
  "CRISIS_COUNSELING",
  "INFORMATION_REFERRAL",
  "CASE_MANAGEMENT",
  "ROAD_CONDITIONS",
  "WEATHER_ALERTS",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export interface ContactMethod {
  kind: "PHONE" | "TEXT" | "WEB" | "IN_PERSON";
  /** Phone number, SMS short code, URL or street address. */
  value: string;
  label: string;
  hours?: string;
}

export interface EligibilityRule {
  id: string;
  description: string;
  /** Machine-checkable condition; rules without one are shown as information only. */
  requires?: "FEDERAL_DECLARATION" | "STATE_ACTIVATION";
}

export interface AssistanceService {
  id: string;
  name: string;
  provider: string;
  description: string;
  serviceTypes: ServiceType[];
  /** Service area as GeoJSON; the navigator only recommends services whose area contains the request. */
  geography: Geometry;
  geographyLabel: string;
  eligibility?: EligibilityRule[];
  contactMethods: ContactMethod[];
  /** Where this entry comes from — the page a person can check. */
  authoritativeSource: string;
  /** When the entry was last checked against that source (ISO date). */
  lastVerifiedAt: string;
  /** Standing public service, or an exercise-only activation (open shelter, distribution point). */
  simulated: boolean;
  accessible?: boolean;
  languages?: string[];
}

/** A service as recommended for one need, with the reason and eligibility outcome. */
export interface ServiceRecommendation {
  service: AssistanceService;
  reason: string;
  /** Eligibility conditions not met right now (e.g. no federal declaration yet). */
  pending: string[];
}
