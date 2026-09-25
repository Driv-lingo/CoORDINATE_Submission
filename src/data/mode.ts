import type { DataMode } from "@/domain/ops";

/** The one workspace that holds real, ingested Virginia feed data. Served at /live. */
export const LIVE_WS = "live";

/**
 * Operational mode is chosen per workspace, i.e. per route — never by one global switch:
 *   /live            → the live workspace → live provider (real feeds only, never scenario data)
 *   /demo and the rest → sandboxes or the shared exercise → scenario provider (deterministic, offline)
 */
export function workspaceMode(ws: string): DataMode {
  return ws === LIVE_WS ? "LIVE" : "SCENARIO";
}
