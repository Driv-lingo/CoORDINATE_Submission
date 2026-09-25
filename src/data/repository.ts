import type { CameraResource, OperationalEvent } from "@/domain/ops";
import type { Incident, Mission, Responder } from "@/domain/types";

/**
 * Persistence port. Every document is scoped to a workspace (an operation /
 * jurisdiction — and, in demo mode, a private sandbox per browser) which is
 * also the Cosmos DB partition key.
 */
export interface Repository {
  readonly provider: "cosmos" | "memory";

  /** Seed the workspace with the demo scenario if it has no data. */
  ensureWorkspace(ws: string): Promise<void>;
  /** Delete everything in the workspace and re-seed it. */
  resetWorkspace(ws: string): Promise<void>;

  listIncidents(ws: string): Promise<Incident[]>;
  getIncident(ws: string, id: string): Promise<Incident | null>;
  saveIncident(incident: Incident): Promise<void>;

  listMissions(ws: string): Promise<Mission[]>;
  getMission(ws: string, id: string): Promise<Mission | null>;
  saveMission(mission: Mission): Promise<void>;

  listResponders(ws: string): Promise<Responder[]>;
  getResponder(ws: string, id: string): Promise<Responder | null>;
  saveResponder(responder: Responder): Promise<void>;

  /** Operational events: a sandbox's exercise events, or the "live" workspace's ingested feed items. */
  listEvents(ws: string): Promise<OperationalEvent[]>;
  saveEvents(events: OperationalEvent[]): Promise<void>;
  deleteEvents?(ws: string, ids: string[]): Promise<void>;

  listCameras(ws: string): Promise<CameraResource[]>;
  getCamera(ws: string, id: string): Promise<CameraResource | null>;
  saveCamera(camera: CameraResource): Promise<void>;
}
