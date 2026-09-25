import { LIVE_WS, workspaceMode } from "@/data/mode";
import type { Repository } from "@/data/repository";
import type { CameraResource, DataMode, OperationalEvent, ProviderHealth } from "@/domain/ops";
import { liveCameras, liveEvents, liveProviderHealth, liveReadiness } from "@/providers/registry";

/**
 * Where a workspace's operational picture comes from. Both implementations return the same
 * normalized OperationalEvents, so correlation, routing, reassessment and every dashboard
 * component work unchanged in either mode.
 *
 *   scenario — /demo sandboxes and the shared exercise: the deterministic, simulated events
 *              stored with the workspace. Never makes a network call.
 *   live     — every page except /demo: real feed items ingested into the "live" workspace
 *              (NWS, VDOT, …) plus the operation's own real reports.
 *              Never falls back to scenario data: a failed source is reported, not filled in.
 */
export interface SituationProvider {
  readonly mode: DataMode;
  events(repo: Repository, ws: string, now: Date, waitMs?: number): Promise<OperationalEvent[]>;
  cameras(repo: Repository, ws: string, now: Date): Promise<CameraResource[]>;
  /** False while a configured source has not delivered current data. */
  readiness(now: Date): { complete: boolean; missing: string[] };
  sources(now: Date): (ProviderHealth & { tier?: 1 | 2 | 3; describes?: string })[];
}

export const scenarioSituation: SituationProvider = {
  mode: "SCENARIO",
  events: (repo, ws) => repo.listEvents(ws),
  cameras: (repo, ws) => repo.listCameras(ws),
  readiness: () => ({ complete: true, missing: [] }),
  sources: () => [],
};

export const liveSituation: SituationProvider = {
  mode: "LIVE",
  // Ingested feed items, plus what the operation itself records: residents' reports, camera-AI observations.
  events: async (repo, ws, now, waitMs = 0) => {
    const [feed, stored] = await Promise.all([liveEvents(now, waitMs), repo.listEvents(ws)]);
    return [...feed, ...stored.filter((e) => !e.provenance && !e.simulated)];
  },
  cameras: (_repo, _ws, now) => liveCameras(now),
  readiness: (now) => liveReadiness(now),
  sources: (now) => liveProviderHealth(now),
};

export function situationFor(ws: string): SituationProvider {
  return workspaceMode(ws) === "LIVE" ? liveSituation : scenarioSituation;
}

export { LIVE_WS };
