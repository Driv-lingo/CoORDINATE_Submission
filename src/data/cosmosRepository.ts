import { CosmosClient, type Container, type Database } from "@azure/cosmos";
import type { CameraResource, OperationalEvent } from "@/domain/ops";
import type { Incident, Mission, Responder } from "@/domain/types";
import type { Repository } from "./repository";
import { buildSeedWorld } from "./seed";

type Doc = { id: string; workspaceId: string };
type Kind = "incidents" | "missions" | "responders" | "ops";
type OpsDocType = "event" | "camera";

/** Demo sandbox workspaces expire after 7 days; named operations never expire. */
const SANDBOX_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Azure Cosmos DB (NoSQL API) repository.
 *
 *  database  : COSMOS_DATABASE (default "coordinate")
 *  containers: incidents, missions, responders, ops (operational events and
 *              cameras, distinguished by a docType field)
 *  partition : /workspaceId  — an operation/jurisdiction, or a demo sandbox
 *
 * Database and containers are created on first use, so a fresh serverless
 * account works with no manual setup.
 */
export class CosmosRepository implements Repository {
  readonly provider = "cosmos" as const;
  private client: CosmosClient;
  private dbName: string;
  private ready?: Promise<Record<Kind, Container>>;
  private seeded = new Set<string>();

  constructor(opts: { endpoint: string; key: string; database: string }) {
    this.client = new CosmosClient({ endpoint: opts.endpoint, key: opts.key });
    this.dbName = opts.database;
  }

  private containers(): Promise<Record<Kind, Container>> {
    this.ready ??= (async () => {
      const { database } = await this.client.databases.createIfNotExists({ id: this.dbName });
      const make = async (db: Database, id: Kind) =>
        (await db.containers.createIfNotExists({ id, partitionKey: { paths: ["/workspaceId"] }, defaultTtl: -1 })).container;
      const [incidents, missions, responders, ops] = await Promise.all([
        make(database, "incidents"),
        make(database, "missions"),
        make(database, "responders"),
        make(database, "ops"),
      ]);
      return { incidents, missions, responders, ops };
    })().catch((err) => {
      this.ready = undefined;
      throw err;
    });
    return this.ready;
  }

  private static strip<T>(doc: T & Record<string, unknown>): T {
    const { _rid, _self, _etag, _attachments, _ts, ttl, docType, ...rest } = doc;
    void _rid; void _self; void _etag; void _attachments; void _ts; void ttl; void docType;
    return rest as T;
  }

  private withTtl<T extends Doc>(doc: T): T & { ttl?: number } {
    return doc.workspaceId.startsWith("sbx-") ? { ...doc, ttl: SANDBOX_TTL_SECONDS } : doc;
  }

  private async list<T extends Doc>(kind: Kind, ws: string): Promise<T[]> {
    const c = (await this.containers())[kind];
    const { resources } = await c.items
      .query<T & Record<string, unknown>>({ query: "SELECT * FROM c WHERE c.workspaceId = @ws", parameters: [{ name: "@ws", value: ws }] }, { partitionKey: ws })
      .fetchAll();
    return resources.map((d) => CosmosRepository.strip<T>(d));
  }

  private async get<T extends Doc>(kind: Kind, ws: string, id: string): Promise<T | null> {
    const c = (await this.containers())[kind];
    try {
      const { resource } = await c.item(id, ws).read<T & Record<string, unknown>>();
      return resource ? CosmosRepository.strip<T>(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  private async listOps<T extends Doc>(docType: OpsDocType, ws: string): Promise<T[]> {
    const c = (await this.containers()).ops;
    const { resources } = await c.items
      .query<T & Record<string, unknown>>(
        { query: "SELECT * FROM c WHERE c.workspaceId = @ws AND c.docType = @t", parameters: [{ name: "@ws", value: ws }, { name: "@t", value: docType }] },
        { partitionKey: ws },
      )
      .fetchAll();
    return resources.map((d) => CosmosRepository.strip<T>(d));
  }

  private async save<T extends Doc>(kind: Kind, doc: T): Promise<void> {
    const c = (await this.containers())[kind];
    await c.items.upsert(this.withTtl(doc));
  }

  async ensureWorkspace(ws: string) {
    if (this.seeded.has(ws)) return;
    const c = (await this.containers()).responders;
    const { resources } = await c.items
      .query<number>({ query: "SELECT VALUE COUNT(1) FROM c WHERE c.workspaceId = @ws", parameters: [{ name: "@ws", value: ws }] }, { partitionKey: ws })
      .fetchAll();
    if ((resources[0] ?? 0) === 0) await this.seed(ws);
    this.seeded.add(ws);
  }

  private async seed(ws: string) {
    const world = buildSeedWorld(ws);
    const cs = await this.containers();
    const run = async <T extends Doc>(container: Container, docs: T[]) => {
      for (let i = 0; i < docs.length; i += 10) {
        await Promise.all(docs.slice(i, i + 10).map((d) => container.items.upsert(this.withTtl(d))));
      }
    };
    await run(cs.responders, world.responders);
    await run(cs.missions, world.missions);
    await run(cs.incidents, world.incidents);
    await run(cs.ops, [...world.events.map((e) => ({ ...e, docType: "event" })), ...world.cameras.map((c) => ({ ...c, docType: "camera" }))]);
  }

  async resetWorkspace(ws: string) {
    const cs = await this.containers();
    for (const kind of ["incidents", "missions", "responders", "ops"] as Kind[]) {
      const docs = await this.list<Doc>(kind, ws);
      for (let i = 0; i < docs.length; i += 10) {
        await Promise.all(docs.slice(i, i + 10).map((d) => cs[kind].item(d.id, ws).delete().catch(() => undefined)));
      }
    }
    this.seeded.delete(ws);
    await this.seed(ws);
    this.seeded.add(ws);
  }

  listIncidents(ws: string) {
    return this.list<Incident>("incidents", ws);
  }
  getIncident(ws: string, id: string) {
    return this.get<Incident>("incidents", ws, id);
  }
  saveIncident(d: Incident) {
    return this.save("incidents", d);
  }
  listMissions(ws: string) {
    return this.list<Mission>("missions", ws);
  }
  getMission(ws: string, id: string) {
    return this.get<Mission>("missions", ws, id);
  }
  saveMission(d: Mission) {
    return this.save("missions", d);
  }
  listResponders(ws: string) {
    return this.list<Responder>("responders", ws);
  }
  getResponder(ws: string, id: string) {
    return this.get<Responder>("responders", ws, id);
  }
  saveResponder(d: Responder) {
    return this.save("responders", d);
  }

  listEvents(ws: string) {
    return this.listOps<OperationalEvent>("event", ws);
  }
  async saveEvents(events: OperationalEvent[]) {
    for (let i = 0; i < events.length; i += 10) await Promise.all(events.slice(i, i + 10).map((e) => this.save("ops", { ...e, docType: "event" })));
  }
  async deleteEvents(ws: string, ids: string[]) {
    const c = (await this.containers()).ops;
    for (let i = 0; i < ids.length; i += 10) await Promise.all(ids.slice(i, i + 10).map((id) => c.item(id, ws).delete().catch(() => undefined)));
  }
  listCameras(ws: string) {
    return this.listOps<CameraResource>("camera", ws);
  }
  getCamera(ws: string, id: string) {
    return this.get<CameraResource>("ops", ws, id);
  }
  saveCamera(c: CameraResource) {
    return this.save("ops", { ...c, docType: "camera" });
  }
}
