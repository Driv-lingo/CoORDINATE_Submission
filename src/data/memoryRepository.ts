import type { CameraResource, OperationalEvent } from "@/domain/ops";
import type { Incident, Mission, Responder } from "@/domain/types";
import type { Repository } from "./repository";
import { LIVE_WS } from "./mode";
import { buildSeedWorld } from "./seed";

interface Store {
  incidents: Map<string, Incident>;
  missions: Map<string, Mission>;
  responders: Map<string, Responder>;
  events: Map<string, OperationalEvent>;
  cameras: Map<string, CameraResource>;
  lastAccess: number;
}

const MAX_WORKSPACES = 300;

/**
 * In-memory repository. Default when Cosmos DB is not configured. State lives
 * for the life of the Node process (survives hot reload via globalThis).
 * Documents are cloned on the way in and out to mimic real persistence.
 */
export class MemoryRepository implements Repository {
  readonly provider = "memory" as const;
  private stores: Map<string, Store>;

  constructor() {
    const g = globalThis as unknown as { __coordinateMemory?: Map<string, Store> };
    // Stores from an older contract (dev hot reload) lack operational data: start fresh.
    if (g.__coordinateMemory && [...g.__coordinateMemory.values()].some((s) => !s.events)) g.__coordinateMemory = undefined;
    g.__coordinateMemory ??= new Map();
    this.stores = g.__coordinateMemory;
  }

  private store(ws: string): Store {
    let s = this.stores.get(ws);
    if (!s) {
      const world = buildSeedWorld(ws);
      s = {
        incidents: new Map(world.incidents.map((d) => [d.id, d])),
        missions: new Map(world.missions.map((d) => [d.id, d])),
        responders: new Map(world.responders.map((d) => [d.id, d])),
        events: new Map(world.events.map((d) => [d.id, d])),
        cameras: new Map(world.cameras.map((d) => [d.id, d])),
        lastAccess: Date.now(),
      };
      this.stores.set(ws, s);
      this.evict();
    }
    s.lastAccess = Date.now();
    return s;
  }

  private evict() {
    if (this.stores.size <= MAX_WORKSPACES) return;
    // The live workspace holds ingested feed data for everyone: never evict it.
    const oldest = [...this.stores.entries()].filter(([ws]) => ws !== LIVE_WS).sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
    if (oldest) this.stores.delete(oldest[0]);
  }

  async ensureWorkspace(ws: string) {
    this.store(ws);
  }

  async resetWorkspace(ws: string) {
    this.stores.delete(ws);
    this.store(ws);
  }

  async listIncidents(ws: string) {
    return [...this.store(ws).incidents.values()].map((d) => structuredClone(d));
  }
  async getIncident(ws: string, id: string) {
    const d = this.store(ws).incidents.get(id);
    return d ? structuredClone(d) : null;
  }
  async saveIncident(d: Incident) {
    this.store(d.workspaceId).incidents.set(d.id, structuredClone(d));
  }

  async listMissions(ws: string) {
    return [...this.store(ws).missions.values()].map((d) => structuredClone(d));
  }
  async getMission(ws: string, id: string) {
    const d = this.store(ws).missions.get(id);
    return d ? structuredClone(d) : null;
  }
  async saveMission(d: Mission) {
    this.store(d.workspaceId).missions.set(d.id, structuredClone(d));
  }

  async listResponders(ws: string) {
    return [...this.store(ws).responders.values()].map((d) => structuredClone(d));
  }
  async getResponder(ws: string, id: string) {
    const d = this.store(ws).responders.get(id);
    return d ? structuredClone(d) : null;
  }
  async saveResponder(d: Responder) {
    this.store(d.workspaceId).responders.set(d.id, structuredClone(d));
  }

  async listEvents(ws: string) {
    return [...this.store(ws).events.values()].map((d) => structuredClone(d));
  }
  async saveEvents(events: OperationalEvent[]) {
    for (const d of events) this.store(d.workspaceId).events.set(d.id, structuredClone(d));
  }
  async deleteEvents(ws: string, ids: string[]) {
    for (const id of ids) this.store(ws).events.delete(id);
  }

  async listCameras(ws: string) {
    return [...this.store(ws).cameras.values()].map((d) => structuredClone(d));
  }
  async getCamera(ws: string, id: string) {
    const d = this.store(ws).cameras.get(id);
    return d ? structuredClone(d) : null;
  }
  async saveCamera(d: CameraResource) {
    this.store(d.workspaceId).cameras.set(d.id, structuredClone(d));
  }
}
