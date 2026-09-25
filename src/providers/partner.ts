import type { LiveProvider } from "./types";

/**
 * Tier 2 sources that require a formal agreement. These adapters exist so the
 * architecture has a place for them, but they never fetch anything without an
 * authorized integration — and never by scraping.
 */

export const ringProvider: LiveProvider = {
  id: "ring",
  name: "Ring cameras (owner opt-in)",
  category: "CAMERAS",
  tier: 2,
  liveState: "LIVE",
  pollSeconds: 3600,
  describes: "Owner-authorized snapshots only: explicit consent, least privilege, revocable, access-logged, no continuous recording.",
  unavailable: () => ({
    state: "PARTNER_REQUIRED",
    detail: "No Ring API integration. Requires a Ring partnership and per-owner consent; the scenario uses a simulated opt-in device.",
  }),
};

/**
 * PulsePoint's terms prohibit scraping. This is a placeholder for a future
 * authorized data-sharing agreement only.
 */
export const pulsePointPartnerProvider: LiveProvider = {
  id: "pulsepoint-partner",
  name: "PulsePoint (partner agreement)",
  category: "PUBLIC_SAFETY",
  tier: 2,
  liveState: "LIVE_DELAYED",
  pollSeconds: 3600,
  describes: "Would provide delayed public incident awareness under an authorized agreement. Not scraped.",
  unavailable: () => ({ state: "PARTNER_REQUIRED", detail: "Requires an authorized PulsePoint data agreement. CoORDINATE does not scrape PulsePoint." }),
};

export const agencyCadProvider: LiveProvider = {
  id: "agency-cad",
  name: "Agency CAD (read-only partner link)",
  category: "PUBLIC_SAFETY",
  tier: 2,
  liveState: "LIVE",
  pollSeconds: 3600,
  describes: "Read-only awareness under a data-sharing agreement. CoORDINATE never writes to CAD or assigns official units.",
  unavailable: () => ({ state: "PARTNER_REQUIRED", detail: "Requires a data-sharing agreement with the 911 center. Read-only by design — no write access." }),
};
