import { z } from "zod";
import { aiProvider, analyzeCameraFrame } from "@/ai";
import { config } from "@/config";
import { INJECTION_LABELS, INJECTIONS, injectionEvents, injectionExpires } from "@/data/scenarioOps";
import { sourceHealthLevel, type CameraView, type ClusterView, type LiveEventRow, type LiveView, type OpsMissionView, type OpsView, type ProviderRow, type PublicHazard, type ReassessChange } from "@/domain/dto";
import type { CameraResource, DataMode, EventCluster, OperationalEvent, RoutePlan } from "@/domain/ops";
import type { Incident, Mission } from "@/domain/types";
import { AUTHORITY_RANK, correlate, isStale, restrictionsFrom } from "@/engine/correlate";
import { distanceKm } from "@/engine/geo";
import * as life from "@/engine/lifecycle";
import { assessMission, dispatchOpsChecks, missionExposure, WATCHED_STATUSES } from "@/engine/reassess";
import { missionEndpoints, planDeterministicRoute, type Restriction, type RouteEndpoint, type Slowdown } from "@/engine/routing";
import { leadResponder } from "@/engine/team";
import { azureMapsRoute } from "@/maps/route";
import { LIVE_WS, workspaceMode } from "@/data/mode";
import { situationFor } from "./situation";
import { isValidGeometry } from "@/engine/geometry";
import { liveCameras, liveProviderHealth } from "@/providers/registry";
import { serviceOutcome } from "@/providers/serviceHealth";
import { publishChange } from "@/realtime/pubsub";
import { SCENARIO } from "@/data/seed";
import { HttpError, requireCoordinator, type Ctx } from "./context";
import { withWorkspaceLock } from "./lock";

/**
 * The common operational picture for one workspace, and the service that keeps
 * every active mission consistent with it.
 *
 *   SCENARIO workspaces (/demo sandboxes, the shared exercise): simulated events
 *   stored with the workspace; nothing live can touch fictional missions.
 *   The LIVE workspace (/live): real feed items ingested with provenance
 *   (see server/situation.ts). Never mixed with scenario data.
 *
 * Both modes run the identical correlation → restriction → routing →
 * reassessment code.
 */

export { workspaceMode };

export interface Picture {
  mode: DataMode;
  events: OperationalEvent[];
  clusters: EventCluster[];
  restrictions: Restriction[];
  slowdowns: Slowdown[];
  /** False while a configured live source has not delivered current data: holds may be added, never cleared. */
  complete: boolean;
  missingSources: string[];
}

export async function loadPicture(ctx: Ctx, waitMs = 0): Promise<Picture> {
  const situation = situationFor(ctx.ws);
  // Untrusted geometry never reaches the engine.
  const events = (await situation.events(ctx.repo, ctx.ws, ctx.now, waitMs)).filter((e) => isValidGeometry(e.geometry));
  const readiness = situation.readiness(ctx.now);
  const clusters = correlate(events, ctx.now);
  const { restrictions, slowdowns } = restrictionsFrom(clusters);
  return { mode: situation.mode, events, clusters, restrictions, slowdowns, complete: readiness.complete, missingSources: readiness.missing };
}

/**
 * Live: Azure Maps (traffic-aware, re-checked against exact geometry), else a
 * clearly labelled straight-line estimate — the scenario road graph is not a
 * real network. Scenario: the deterministic road graph.
 */
export async function planRoute(p: Picture, ends: { origin: RouteEndpoint; destination: RouteEndpoint }, version: number, now: Date): Promise<RoutePlan | null> {
  if (p.mode === "LIVE") {
    if (config().maps) {
      const r = await azureMapsRoute({ ...ends, restrictions: p.restrictions, version, now });
      if (r) return r;
    }
    return planDeterministicRoute({ ...ends, restrictions: p.restrictions, slowdowns: p.slowdowns, version, now, allowGraph: false });
  }
  return planDeterministicRoute({ ...ends, restrictions: p.restrictions, slowdowns: p.slowdowns, version, now });
}

/* ------------------------------------------------------------------ */
/* Reassessment                                                        */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __coordinateReassessAt?: Map<string, number> };
const lastRun = (g.__coordinateReassessAt ??= new Map());
const LIVE_WAIT_MS = 2500;

/** Re-evaluate every active mission against the picture. Caller must hold the workspace lock. */
export async function reassessLocked(ctx: Ctx, picture?: Picture): Promise<ReassessChange[]> {
  const p = picture ?? (await loadPicture(ctx, workspaceMode(ctx.ws) === "LIVE" ? LIVE_WAIT_MS : 0));
  const [missions, incidents, responders] = await Promise.all([ctx.repo.listMissions(ctx.ws), ctx.repo.listIncidents(ctx.ws), ctx.repo.listResponders(ctx.ws)]);
  const byId = new Map(incidents.map((i) => [i.id, i]));
  const work = missions
    .filter((x) => WATCHED_STATUSES.includes(x.status) && byId.has(x.incidentId))
    .map((m) => ({ m, incident: byId.get(m.incidentId)!, a: assessMission({ mission: m, incident: byId.get(m.incidentId)!, clusters: p.clusters, restrictions: p.restrictions }) }));
  // Route planning (a network call in live mode) runs for all affected missions in parallel.
  const routes = await Promise.all(
    work.map(async ({ m, incident, a }) => {
      if (!a.needsRoute) return undefined;
      // No live GPS in the prototype: the new route is planned from the team's staging point.
      const ends = missionEndpoints(incident, leadResponder(m, responders));
      return ends ? planRoute(p, ends, (m.route?.version ?? 0) + 1, ctx.now) : null;
    }),
  );
  const changes: ReassessChange[] = [];
  for (const [i, { m, incident, a }] of work.entries()) {
    const r = life.applyAssessment({ incident, mission: m, assessment: a, newRoute: routes[i], allowClear: p.complete, now: ctx.now });
    if (!r.changed) continue;
    await ctx.repo.saveMission(r.mission);
    await ctx.repo.saveIncident(r.incident);
    changes.push({ missionId: m.id, missionCode: m.code, incidentId: incident.id, status: r.mission.status, message: r.incident.timeline.at(-1)?.message ?? "" });
  }
  lastRun.set(ctx.ws, ctx.now.getTime());
  if (changes.length) void publishChange(ctx.ws, "ops.reassessed");
  return changes;
}

export function reassess(ctx: Ctx): Promise<ReassessChange[]> {
  return withWorkspaceLock(ctx.ws, () => reassessLocked(ctx));
}

/**
 * Conditions change with time (warnings expire, reports go stale), so reads
 * trigger a throttled reassessment. Cheap when nothing changed.
 */
export async function maybeReassess(ctx: Ctx, minIntervalMs = 15_000): Promise<ReassessChange[]> {
  if (ctx.now.getTime() - (lastRun.get(ctx.ws) ?? 0) < minIntervalMs) return [];
  lastRun.set(ctx.ws, ctx.now.getTime());
  return reassess(ctx);
}

/** Route + operational checks for the dispatch gate (and its preview). */
export async function dispatchContext(ctx: Ctx, incident: Incident, mission: Mission, responders: Parameters<typeof leadResponder>[1], picture?: Picture) {
  const p = picture ?? (await loadPicture(ctx, workspaceMode(ctx.ws) === "LIVE" ? LIVE_WAIT_MS : 0));
  const ends = missionEndpoints(incident, leadResponder(mission, responders));
  const route = ends ? await planRoute(p, ends, 1, ctx.now) : null;
  const checks = dispatchOpsChecks({ incident, mission, clusters: p.clusters, restrictions: p.restrictions, route, missingSources: p.mode === "LIVE" ? p.missingSources : undefined });
  return { route, checks };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function clusterView(c: EventCluster, events: OperationalEvent[], now: Date, mode: DataMode): ClusterView {
  const members = events.filter((e) => c.memberIds.includes(e.id));
  const primary = members.find((e) => e.id === c.primaryId) ?? members[0];
  return {
    ...c,
    category: primary?.category ?? "COMMUNITY",
    mode,
    simulated: members.every((e) => e.simulated),
    stale: members.every((e) => isStale(e, now)),
    publicDetailLevel: primary?.publicDetailLevel,
    latencySeconds: primary?.latencySeconds,
    roadName: members.find((e) => e.roadName)?.roadName,
    incidentIds: Array.from(new Set(members.map((e) => e.incidentId).filter((x): x is string => !!x))),
    review: members.find((e) => e.coordinatorReview)?.coordinatorReview,
  };
}

const CLUSTER_ORDER = (c: ClusterView) => (c.actionableEffects.some((e) => e.kind !== "ADVISORY") ? 0 : c.pendingEffects.length ? 1 : c.stale ? 3 : 2);

function consentActive(c: CameraResource, now: Date): boolean {
  const k = c.consent;
  return !!k && !k.revokedAt && k.scope !== "DISABLED" && (!k.expiresAt || new Date(k.expiresAt) > now);
}

function cameraView(c: CameraResource, events: OperationalEvent[], now: Date, full: boolean): CameraView {
  const obs = events
    .filter((e) => e.camera?.cameraId === c.id && !isStale(e, now))
    .sort((a, b) => (b.eventTime ?? b.fetchedAt).localeCompare(a.eventTime ?? a.fetchedAt))[0];
  return {
    id: c.id,
    name: c.name,
    sourceType: c.sourceType,
    provider: c.provider,
    location: c.location,
    status: c.status,
    simulated: c.simulated,
    // Private cameras never expose a standing image URL; snapshots are requested per purpose.
    snapshotUrl: c.consent ? undefined : obs?.camera?.mediaReference ?? c.snapshotUrl,
    consent: c.consent
      ? { ownerLabel: c.consent.ownerLabel, scope: c.consent.scope, purpose: c.consent.purpose, expiresAt: c.consent.expiresAt, revoked: !!c.consent.revokedAt, active: consentActive(c, now) }
      : undefined,
    accessLog: full ? c.accessLog.slice(-12) : undefined,
    latestObservation: obs ? { at: obs.eventTime ?? obs.fetchedAt, label: obs.title, eventId: obs.id } : undefined,
  };
}

function serviceRows(): ProviderRow[] {
  const c = config();
  const row = (id: string, name: string, category: ProviderRow["category"], configured: boolean, fallback: string): ProviderRow => {
    if (!configured) return { id, name, category, group: "SERVICE", state: "NOT_CONFIGURED", detail: fallback };
    const o = serviceOutcome(id);
    if (!o || (!o.lastSuccessAt && !o.lastFailureAt)) return { id, name, category, group: "SERVICE", state: "CONNECTED", detail: "Configured — no calls yet in this process." };
    const failedLast = (o.lastFailureAt ?? 0) > (o.lastSuccessAt ?? 0);
    return {
      id,
      name,
      category,
      group: "SERVICE",
      state: failedLast ? (o.lastSuccessAt ? "DEGRADED" : "OFFLINE") : "CONNECTED",
      detail: failedLast ? `Last call failed: ${o.lastError}. Local fallback in use.` : `${o.successes} successful call(s).`,
      lastSuccessAt: o.lastSuccessAt ? new Date(o.lastSuccessAt).toISOString() : undefined,
      lastError: failedLast ? o.lastError : undefined,
    };
  };
  const ai = aiProvider();
  return [
    row("azure-ai-foundry", `Azure AI Foundry${ai.model ? ` (${ai.model})` : ""}`, "AI", !!c.foundry, "Not configured — local rules interpreter and templates in use."),
    row("azure-maps", "Azure Maps (geocoding, routing, tiles)", "MAPS", !!c.maps, "Not configured — OpenStreetMap tiles, offline gazetteer and scenario road graph in use."),
    {
      id: "cosmos",
      name: "Azure Cosmos DB",
      category: "DATA",
      group: "SERVICE",
      state: c.cosmos ? "CONNECTED" : "NOT_CONFIGURED",
      detail: c.cosmos ? `Database “${c.cosmos.database}”.` : "Not configured — in-memory store (resets on restart).",
    },
    {
      id: "web-pubsub",
      name: "Azure Web PubSub",
      category: "REALTIME",
      group: "SERVICE",
      state: c.webPubSub ? "CONNECTED" : "NOT_CONFIGURED",
      detail: c.webPubSub ? `Hub “${c.webPubSub.hub}”.` : "Not configured — browsers poll every 5 s.",
    },
  ];
}

export function providerRows(mode: DataMode, scenarioEventCount: number): ProviderRow[] {
  const live: ProviderRow[] = liveProviderHealth().map((h) => ({ ...h, group: "LIVE_FEED" as const }));
  const scenario: ProviderRow[] =
    mode === "SCENARIO"
      ? [
          {
            id: "scenario",
            name: `Scenario feeds — ${SCENARIO.name}`,
            category: "DATA",
            group: "SCENARIO",
            state: "SIMULATED",
            detail: `${scenarioEventCount} simulated event(s) (NWS, IPAWS, VDOT, cameras, CAD, news). Every item is labelled SIMULATED; live feeds never affect this exercise.`,
          },
        ]
      : [];
  return [...scenario, ...serviceRows(), ...live];
}

function missionView(m: Mission, incident: Incident, lead?: { id: string; name: string }): OpsMissionView {
  return {
    id: m.id,
    code: m.code,
    title: m.title,
    incidentId: incident.id,
    incidentNumber: incident.number,
    status: m.status,
    locationLabel: incident.locationLabel,
    location: incident.location,
    exposure: missionExposure(incident),
    lead,
    route: m.route,
    previousRoute: m.routeHistory?.at(-1),
    hold: m.hold,
    heldFrom: m.heldFrom,
    decisions: (m.decisions ?? []).slice(-8),
  };
}

export async function buildOpsView(ctx: Ctx, changes?: ReassessChange[]): Promise<OpsView> {
  const p = await loadPicture(ctx, 1500);
  const [missions, incidents, responders, cameras] = await Promise.all([
    ctx.repo.listMissions(ctx.ws),
    ctx.repo.listIncidents(ctx.ws),
    ctx.repo.listResponders(ctx.ws),
    situationFor(ctx.ws).cameras(ctx.repo, ctx.ws, ctx.now),
  ]);
  const coordinator = ctx.persona.kind === "coordinator";
  const incById = new Map(incidents.map((i) => [i.id, i]));
  const allClusters = p.clusters.map((c) => clusterView(c, p.events, ctx.now, p.mode)).sort((a, b) => CLUSTER_ORDER(a) - CLUSTER_ORDER(b));
  // Private-camera evidence (location, camera name) is for coordinators only.
  const privateIds = new Set(p.events.filter((e) => e.sourceType === "PRIVATE_CAMERA").map((e) => e.id));
  const clusters = coordinator
    ? allClusters
    : allClusters
        .filter((c) => c.memberIds.some((id) => !privateIds.has(id)))
        .map((c) => ({ ...c, evidence: c.evidence.filter((e) => !privateIds.has(e.eventId)), incidentIds: [] }));
  const active = missions.filter((m) => WATCHED_STATUSES.includes(m.status) && incById.has(m.incidentId));
  // Routes start at a volunteer's staging location: coordinators see every mission,
  // a volunteer sees only their own, residents see none.
  const visibleMissions = coordinator ? active : ctx.persona.kind === "responder" ? active.filter((m) => m.assignments.some((a) => a.responderId === ctx.persona.id)) : [];
  const visibleIds = new Set(visibleMissions.map((m) => m.id));
  const visibleCameras = cameras.filter((c) => !c.consent || coordinator || (ctx.persona.kind === "resident" && c.consent.ownerLabel.startsWith(ctx.persona.name)));
  return {
    mode: p.mode,
    generatedAt: ctx.now.toISOString(),
    clusters,
    cameras: visibleCameras.map((c) => cameraView(c, p.events, ctx.now, coordinator)),
    missions: visibleMissions.map((m) => {
      const lead = leadResponder(m, responders);
      return missionView(m, incById.get(m.incidentId)!, lead ? { id: lead.id, name: lead.name } : undefined);
    }),
    providers: providerRows(p.mode, p.mode === "SCENARIO" ? p.events.length : 0),
    injections: p.mode === "SCENARIO" && coordinator ? INJECTIONS.map((id) => ({ id, ...INJECTION_LABELS[id] })) : undefined,
    summary: {
      actionable: clusters.filter((c) => c.actionableEffects.some((e) => e.kind !== "ADVISORY")).length,
      pendingReview: clusters.filter((c) => c.pendingEffects.length && !c.stale).length,
      held: active.filter((m) => m.status === "ON_HOLD").length,
      rerouting: active.filter((m) => m.status === "REROUTING").length,
      restrictions: p.restrictions.length,
      stale: clusters.filter((c) => c.stale).length,
    },
    changes: changes?.filter((c) => visibleIds.has(c.missionId)),
  };
}

/**
 * /live: the live workspace's picture — real Virginia feed items with provenance and source
 * health. Read-only. If every source fails the view is empty and says so; it never
 * substitutes scenario data.
 */
export async function buildLiveView(ctx: Ctx): Promise<LiveView> {
  const live = { ...ctx, ws: LIVE_WS };
  const p = await loadPicture(live, 2500);
  const cams = await situationFor(LIVE_WS).cameras(ctx.repo, LIVE_WS, ctx.now);
  const health = liveProviderHealth(ctx.now);
  const levelOf = new Map(health.map((h) => [h.id, sourceHealthLevel(h.state)]));
  const clusters = p.clusters.map((c) => clusterView(c, p.events, ctx.now, "LIVE")).sort((a, b) => CLUSTER_ORDER(a) - CLUSTER_ORDER(b));
  const events: LiveEventRow[] = p.events
    .map((e) => {
      const sourceHealth = levelOf.get(e.provenance!.source) ?? "offline";
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        type: e.type,
        category: e.category,
        severity: e.severity,
        authorityLevel: e.authorityLevel,
        supplemental: e.authorityLevel === "MEDIA_REPORT" || e.authorityLevel === "UNVERIFIED_OPEN_SOURCE",
        sourceName: e.sourceName,
        provenance: e.provenance!,
        startsAt: e.startsAt,
        roadName: e.roadName,
        sourceHealth,
        current: sourceHealth === "healthy" && !isStale(e, ctx.now),
      };
    })
    .sort((a, b) => Number(a.supplemental) - Number(b.supplemental) || SEVERITY_ORDER(a.severity) - SEVERITY_ORDER(b.severity) || (b.provenance.sourceUpdatedAt ?? "").localeCompare(a.provenance.sourceUpdatedAt ?? ""));
  const healthyFetches = health.filter((h) => sourceHealthLevel(h.state) === "healthy" && h.lastSuccessAt).map((h) => h.lastSuccessAt!);
  return {
    mode: "LIVE",
    generatedAt: ctx.now.toISOString(),
    clusters,
    cameras: cams.map((c) => cameraView(c, p.events, ctx.now, false)),
    missions: [],
    providers: providerRows("LIVE", 0),
    sources: health.map((h) => ({ ...h, group: "LIVE_FEED" as const, level: sourceHealthLevel(h.state) })),
    events,
    lastUpdatedAt: healthyFetches.sort().at(-1),
    realtime: !!config().webPubSub,
    summary: {
      actionable: clusters.filter((c) => c.actionableEffects.some((e) => e.kind !== "ADVISORY")).length,
      pendingReview: clusters.filter((c) => c.pendingEffects.length && !c.stale).length,
      held: 0,
      rerouting: 0,
      restrictions: p.restrictions.length,
      stale: clusters.filter((c) => c.stale).length,
    },
  };
}

const SEVERITY_ORDER = (s?: string) => ["EXTREME", "SEVERE", "MODERATE", "MINOR"].indexOf(s ?? "") >>> 0;

/** Public hazard map: actionable conditions only. No volunteers, residents, incidents or private cameras. */
export async function buildPublicHazards(ctx: Ctx): Promise<{ mode: DataMode; generatedAt: string; hazards: PublicHazard[] }> {
  const p = await loadPicture(ctx, 1500);
  const hazards: PublicHazard[] = p.clusters
    .filter((c) => c.status === "AUTHORITATIVE" || c.status === "CORROBORATED")
    // Road/area effects, plus official warnings that are advisory-only (e.g. flash flood warning).
    .filter((c) => c.actionableEffects.length || p.events.some((e) => c.memberIds.includes(e.id) && (e.category === "ALERT" || e.category === "WEATHER") && e.authorityLevel === "AUTHORITATIVE_ALERT"))
    .filter((c) => !p.events.some((e) => c.memberIds.includes(e.id) && e.publicDetailLevel === "AREA_ONLY"))
    .map((c) => {
      const members = p.events.filter((e) => c.memberIds.includes(e.id));
      // Official sources only, highest authority first: resident wording and camera AI labels never become public titles.
      const official = members
        .filter((e) => e.sourceType !== "COMMUNITY" && e.sourceType !== "PRIVATE_CAMERA" && e.authorityLevel !== "MACHINE_DERIVED_OBSERVATION" && e.authorityLevel !== "UNVERIFIED_OPEN_SOURCE")
        .sort((a, b) => AUTHORITY_RANK[a.authorityLevel] - AUTHORITY_RANK[b.authorityLevel]);
      const primary = official[0] ?? members[0];
      return {
        // Opaque id: cluster ids can embed incident ids (community reports).
        id: `hz-${opaqueId(c.id)}`,
        // Community wording never appears publicly; the official title is used, or a generic one.
        title: official.length ? primary.title : c.type === "FLOODING" ? "Reported flooding (corroborated)" : "Reported road obstruction (corroborated)",
        type: c.type,
        category: primary.category,
        geometry: c.geometry,
        status: c.status,
        sources: Array.from(new Set(members.filter((e) => e.sourceType !== "PRIVATE_CAMERA").map((e) => (e.sourceType === "COMMUNITY" ? "Resident reports" : e.sourceName)))),
        effects: c.actionableEffects.length ? c.actionableEffects.map((e) => e.kind) : ["ADVISORY"],
        expiresAt: c.expiresAt,
        simulated: members.every((e) => e.simulated),
      };
    });
  return { mode: p.mode, generatedAt: ctx.now.toISOString(), hazards };
}

function opaqueId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ */
/* Scenario controls, reviews, cameras                                 */
/* ------------------------------------------------------------------ */

export const injectSchema = z.object({ inject: z.enum(INJECTIONS) });

export async function injectScenario(ctx: Ctx, input: unknown): Promise<OpsView> {
  requireCoordinator(ctx);
  const parsed = injectSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Unknown scenario injection");
  if (workspaceMode(ctx.ws) !== "SCENARIO") throw new HttpError(409, "Scenario injections are only available in scenario (exercise) workspaces.");
  const changes = await withWorkspaceLock(ctx.ws, async () => {
    const events = await ctx.repo.listEvents(ctx.ws);
    const seq = ctx.now.getTime().toString(36);
    const added = injectionEvents(parsed.data.inject, ctx.ws, ctx.now, seq);
    const expired = injectionExpires(parsed.data.inject, events)
      .map((id) => events.find((e) => e.id === id)!)
      .filter((e) => !e.expiresAt || new Date(e.expiresAt) > ctx.now)
      .map((e) => ({ ...e, expiresAt: ctx.now.toISOString() }));
    await ctx.repo.saveEvents([...added, ...expired]);
    return reassessLocked(ctx);
  });
  void publishChange(ctx.ws, "ops.injected");
  return buildOpsView(ctx, changes);
}

export const reviewSchema = z.object({ action: z.enum(["confirm", "dispute", "clear"]), note: z.string().max(200).optional() });

/** A coordinator confirms (e.g. after looking at the camera frame) or disputes an event. */
export async function reviewEvent(ctx: Ctx, eventId: string, input: unknown): Promise<OpsView> {
  requireCoordinator(ctx);
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid review");
  const changes = await withWorkspaceLock(ctx.ws, async () => {
    const p = await loadPicture(ctx);
    if (!p.events.some((x) => x.id === eventId)) throw new HttpError(404, "Event not found");
    // Patch the stored item (feed items keep their provenance and raw payload; the next poll keeps the review).
    const e = (await ctx.repo.listEvents(ctx.ws)).find((x) => x.id === eventId);
    if (!e) throw new HttpError(404, "Event not found");
    const at = ctx.now.toISOString();
    const updated: OperationalEvent = {
      ...e,
      coordinatorReview: parsed.data.action === "clear" ? undefined : { status: parsed.data.action === "confirm" ? "CONFIRMED" : "DISPUTED", by: ctx.persona.name, at, note: parsed.data.note },
      camera: e.camera && parsed.data.action === "confirm" ? { ...e.camera, humanVerified: true } : e.camera,
    };
    await ctx.repo.saveEvents([updated]);
    return reassessLocked(ctx);
  });
  return buildOpsView(ctx, changes);
}

export const cameraActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("snapshot"), incidentId: z.string().max(80).optional() }),
  z.object({ action: z.literal("revoke") }),
]);

const PURPOSE_RADIUS_KM = 0.4;

type CameraResult = { camera: CameraView; snapshotUrl?: string; observation?: string; changes: ReassessChange[] };
const OPEN_FOR_EVIDENCE = new Set(["GUIDED", "OPEN", "TEAM_FORMING", "ACTIVE"]);

export async function cameraAction(ctx: Ctx, cameraId: string, input: unknown): Promise<CameraResult> {
  const parsed = cameraActionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid camera action");
  const first = await withWorkspaceLock(ctx.ws, () => cameraActionLocked(ctx, cameraId, parsed.data));
  if (!("analyze" in first)) return first;

  // Live public camera: Azure AI Foundry vision runs OUTSIDE the workspace lock (it can take seconds).
  const { cam } = first.analyze;
  const a = await analyzeCameraFrame(cam.snapshotUrl!);
  if (!a || a.observationType === "UNKNOWN" || a.observationType === "ROAD_CLEAR") {
    return { camera: first.view, snapshotUrl: cam.snapshotUrl, observation: a ? `Camera AI: ${a.observationType.replace(/_/g, " ").toLowerCase()}` : undefined, changes: [] };
  }
  const at = new Date().toISOString();
  const obs: OperationalEvent = {
    id: `ev-camai-${cam.id}-${Date.now().toString(36)}`,
    workspaceId: ctx.ws,
    mode: workspaceMode(ctx.ws),
    simulated: false,
    type: "CAMERA_OBSERVATION",
    category: "CAMERA",
    sourceId: cam.id,
    sourceName: `${cam.name} (AI observation · ${a.model})`,
    sourceType: "PUBLIC_CAMERA",
    authorityLevel: "MACHINE_DERIVED_OBSERVATION",
    verificationStatus: "UNVERIFIED",
    title: `Camera AI: ${a.observationType.replace(/_/g, " ").toLowerCase()}${a.description ? ` — ${a.description}` : ""}`,
    geometry: { type: "Point", coordinates: [cam.location.lng, cam.location.lat] },
    eventTime: at,
    fetchedAt: at,
    confidence: a.confidence,
    effects: a.observationType === "ROAD_BLOCKED" || a.observationType === "STANDING_WATER" ? [{ kind: "BLOCKS_ROAD", radiusM: 150 }] : [{ kind: "ADVISORY" }],
    camera: { cameraId: cam.id, cameraName: cam.name, observationType: a.observationType, machineGenerated: true, humanVerified: false, mediaReference: cam.snapshotUrl },
  };
  const changes = await withWorkspaceLock(ctx.ws, async () => {
    await ctx.repo.saveEvents([obs]);
    return reassessLocked({ ...ctx, now: new Date() });
  });
  return { camera: cameraView(cam, [obs], new Date(), true), snapshotUrl: cam.snapshotUrl, observation: obs.title, changes };
}

async function cameraActionLocked(
  ctx: Ctx,
  cameraId: string,
  action: z.infer<typeof cameraActionSchema>,
): Promise<CameraResult | { analyze: { cam: CameraResource }; view: CameraView }> {
  const cam = (await ctx.repo.getCamera(ctx.ws, cameraId)) ?? (workspaceMode(ctx.ws) === "LIVE" ? (await liveCameras(ctx.now)).find((c) => c.id === cameraId) : undefined);
  if (!cam) throw new HttpError(404, "Camera not found");
  // Live cameras are copied into the workspace so their access log is kept with the operation.
  cam.workspaceId = ctx.ws;
  const at = ctx.now.toISOString();
  const events = await ctx.repo.listEvents(ctx.ws);

  if (action.action === "revoke") {
    if (!cam.consent) throw new HttpError(400, "Public cameras have no owner consent to revoke.");
    const isOwner = ctx.persona.kind === "resident" && cam.consent.ownerLabel.startsWith(ctx.persona.name);
    if (!isOwner && ctx.persona.kind !== "coordinator") throw new HttpError(403, "Only the camera owner (or a coordinator on the owner's instruction) can revoke access.");
    cam.consent = { ...cam.consent, revokedAt: at };
    cam.accessLog.push({ at, action: "Consent revoked — snapshots deleted, no further access", by: isOwner ? `${ctx.persona.name} (owner)` : `${ctx.persona.name} (on owner's instruction)` });
    await ctx.repo.saveCamera(cam);
    // Minimal retention: delete media references AND end the observations, so they no longer count as evidence.
    const ended = events
      .filter((e) => e.camera?.cameraId === cam.id && (!e.expiresAt || new Date(e.expiresAt) > ctx.now))
      .map((e) => ({ ...e, expiresAt: at, camera: { ...e.camera!, mediaReference: undefined } }));
    if (ended.length) await ctx.repo.saveEvents(ended);
    void publishChange(ctx.ws, "camera.revoked");
    return { camera: cameraView(cam, events, ctx.now, true), changes: ended.length ? await reassessLocked(ctx) : [] };
  }

  requireCoordinator(ctx);
  if (cam.consent) {
    // Owner-authorized camera: consent must be active, scope must allow snapshots, and access is purpose-bound.
    if (!consentActive(cam, ctx.now)) throw new HttpError(403, "The owner's consent has expired or was revoked. No access.");
    if (cam.consent.scope !== "CURRENT_SNAPSHOT" && cam.consent.scope !== "EMERGENCY_SNAPSHOTS_ONLY") throw new HttpError(403, "The owner has not authorized snapshots.");
    if (!cam.simulated) throw new HttpError(501, "No private-camera integration exists in this prototype (partner agreement required).");
    const incident = action.incidentId ? await ctx.repo.getIncident(ctx.ws, action.incidentId) : null;
    if (!incident || !OPEN_FOR_EVIDENCE.has(incident.status) || distanceKm(incident.location, cam.location) > PURPOSE_RADIUS_KM) {
      throw new HttpError(403, "Snapshots from an opt-in camera may only be requested for an open incident at the owner's address.");
    }
    cam.accessLog.push({ at, action: `Snapshot requested for ${incident.number} (driveway access check)`, by: `${ctx.persona.name} (coordinator)` });
    await ctx.repo.saveCamera(cam);
    const obs: OperationalEvent = {
      id: `ev-ring-${ctx.now.getTime().toString(36)}`,
      workspaceId: ctx.ws,
      mode: workspaceMode(ctx.ws),
      simulated: true,
      type: "CAMERA_OBSERVATION",
      category: "CAMERA",
      sourceId: cam.id,
      sourceName: `${cam.name} — owner-authorized snapshot`,
      sourceType: "PRIVATE_CAMERA",
      authorityLevel: "MACHINE_DERIVED_OBSERVATION",
      verificationStatus: "UNVERIFIED",
      title: "Owner camera: driveway obstructed by a fallen tree",
      geometry: { type: "Point", coordinates: [cam.location.lng, cam.location.lat] },
      eventTime: at,
      // Short retention for private-camera evidence.
      expiresAt: new Date(ctx.now.getTime() + 6 * 3600e3).toISOString(),
      fetchedAt: at,
      effects: [{ kind: "ADVISORY" }],
      camera: { cameraId: cam.id, cameraName: cam.name, observationType: "ACCESS_OBSTRUCTED", machineGenerated: true, humanVerified: false, mediaReference: "/sim/ring-driveway.svg" },
      incidentId: incident.id,
    };
    await ctx.repo.saveEvents([obs]);
    await ctx.repo.saveIncident({
      ...incident,
      updatedAt: at,
      timeline: [...incident.timeline, { at, actor: "coordinator", message: `${ctx.persona.name} viewed one owner-authorized snapshot (${cam.name}) as evidence: driveway obstructed. Access logged; snapshot kept 6 h.` }],
    });
    void publishChange(ctx.ws, "camera.snapshot");
    return { camera: cameraView(cam, [...events, obs], ctx.now, true), snapshotUrl: "/sim/ring-driveway.svg", observation: obs.title, changes: [] };
  }

  // Public camera: current frame. Scenario frames reflect the scenario state.
  cam.accessLog.push({ at, action: "Viewed current frame", by: `${ctx.persona.name} (coordinator)` });
  cam.accessLog = cam.accessLog.slice(-50);
  await ctx.repo.saveCamera(cam);
  if (!cam.simulated && cam.snapshotUrl) return { analyze: { cam }, view: cameraView(cam, events, ctx.now, true) };
  const blocked = events.some((e) => (e.camera?.cameraId === cam.id || (cam.id === "cam-vdot-419-keagy" && e.id.startsWith("ev-511-crash419-"))) && !isStale(e, ctx.now));
  const frame = cam.id === "cam-vdot-419-keagy" ? (blocked ? "/sim/camera-419-blocked.svg" : "/sim/camera-419-clear.svg") : cam.snapshotUrl;
  const latest = events.filter((e) => e.camera?.cameraId === cam.id && !isStale(e, ctx.now)).at(-1);
  return { camera: cameraView(cam, events, ctx.now, true), snapshotUrl: frame, observation: latest?.title, changes: [] };
}
