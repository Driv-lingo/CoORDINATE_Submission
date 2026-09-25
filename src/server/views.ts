import { LIVE_WS } from "@/data/mode";
import { aiProvider } from "@/ai";
import { config } from "@/config";
import { CREDENTIAL_LABELS } from "@/domain/catalog";
import type {
  DisplayStatus,
  IncidentDetail,
  IncidentSummary,
  Kpis,
  ProviderStatus,
  ResponderLite,
  ResponderMarker,
  Snapshot,
  VolunteerView,
} from "@/domain/dto";
import type { RoutePlan } from "@/domain/ops";
import { getService } from "@/data/assistanceDirectory";
import { RESOLUTION_PATHS, type Incident, type Mission, type ResolutionPath, type Responder } from "@/domain/types";
import { hasRequestedHelp, immediatePriority, servicePending } from "@/engine/navigator";
import { navigatorContextFor } from "@/engine/pipeline";
import { scanVulnerabilityEvidence } from "@/engine/textScan";
import { ACTIVE_MISSION_STATUSES, computeCommitments, evaluateCandidate, isInPool, matchIncident } from "@/engine/matching";
import { checkDispatch } from "@/engine/dispatch";
import { distanceKm } from "@/engine/geo";
import { credentialState, readinessLevel } from "@/engine/readiness";
import { assembleTeam } from "@/engine/team";
import type { Ctx } from "./context";
import { dispatchContext, loadPicture } from "./ops";

const VOLUNTEER_HOUR_VALUE = Number(process.env.COORDINATE_VOLUNTEER_HOUR_VALUE ?? 34.79);

export function providerStatus(ws: string): ProviderStatus {
  const c = config();
  return {
    ai: aiProvider(),
    data: c.cosmos ? "cosmos" : "memory",
    maps: c.maps ? "azure-maps" : "openstreetmap",
    realtime: c.webPubSub ? "azure-web-pubsub" : "polling",
    workspace: ws,
    operation: ws === LIVE_WS ? "Live operation — Virginia" : c.operationName,
  };
}

export function summarize(i: Incident, mission: Mission | undefined, responders: Responder[], missions: Mission[], now: Date): IncidentSummary {
  let unfillable: string[] = [];
  let displayStatus: DisplayStatus = i.status;
  if (i.status === "OPEN" || i.status === "TEAM_FORMING") {
    // A dry-run of team formation: roles the engine cannot fill with distinct eligible people/assets.
    const team = assembleTeam({ incident: i, responders, missions, now });
    unfillable = team.unfilledSlotIds.map((id) => i.requirements.find((s) => s.id === id)!.label);
    if (i.status === "OPEN" && unfillable.length) displayStatus = "AWAITING_RESOURCES";
  }
  return {
    id: i.id,
    number: i.number,
    createdAt: i.createdAt,
    status: i.status,
    displayStatus,
    priority: i.priority.level,
    priorityScore: i.priority.score,
    triage: i.triage.level,
    category: i.assessment.category,
    summary: i.assessment.summary,
    locality: i.locality,
    locationLabel: i.locationLabel,
    location: i.location,
    peopleAffected: i.assessment.peopleAffected,
    needs: i.assessment.needs,
    paths: [...new Set((i.needs ?? []).map((n) => n.path))],
    helpRequested: hasRequestedHelp(i.needs ?? []) || !!i.missionId,
    hazards: i.assessment.hazards.filter((h) => !i.hazardClearances.some((c) => c.hazard === h)),
    vulnerabilities: i.assessment.vulnerabilities,
    requiredAssets: Array.from(new Set(i.requirements.filter((s) => s.asset).map((s) => s.asset!))),
    requiredRoles: i.requirements.filter((s) => s.kind === "PERSON").map((s) => s.label),
    unfillableRoles: unfillable,
    pendingAdvisories: i.advisories.filter((a) => a.requiresAcknowledgement && !a.acknowledgedAt).length,
    missionCode: mission?.code,
    missionStatus: mission?.status,
    missionTitle: mission?.title,
  };
}

export function lite(r: Responder, now: Date): ResponderLite {
  const rl = readinessLevel(r, now);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    role: r.role,
    headline: r.headline,
    locality: r.locality,
    location: r.location,
    availability: r.availability.status,
    readinessLevel: rl.level,
    readinessName: rl.name,
  };
}

const byPriority = (a: IncidentSummary, b: IncidentSummary) =>
  b.priorityScore - a.priorityScore || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

export async function buildSnapshot(ctx: Ctx): Promise<Snapshot> {
  const [incidents, missions, responders] = await Promise.all([
    ctx.repo.listIncidents(ctx.ws),
    ctx.repo.listMissions(ctx.ws),
    ctx.repo.listResponders(ctx.ws),
  ]);
  const missionById = new Map(missions.map((m) => [m.id, m]));
  const summaries = incidents.map((i) => summarize(i, i.missionId ? missionById.get(i.missionId) : undefined, responders, missions, ctx.now)).sort(byPriority);

  const counts: Record<DisplayStatus, number> = { OPEN: 0, AWAITING_RESOURCES: 0, TEAM_FORMING: 0, ACTIVE: 0, RESOLVED: 0, ESCALATED: 0, LOGGED: 0, GUIDED: 0, CANCELLED: 0 };
  for (const s of summaries) counts[s.displayStatus]++;

  const commitments = computeCommitments(missions, undefined, responders);
  const markers: ResponderMarker[] = responders.map((r) => {
    const busy = commitments.personBusy.get(r.id);
    const orgBusy = r.kind === "ORGANIZATION" && missions.some((m) => ACTIVE_MISSION_STATUSES.includes(m.status) && m.assignments.some((a) => a.responderId === r.id));
    const state: ResponderMarker["state"] = !r.identityVerified
      ? "UNVERIFIED"
      : busy || orgBusy
        ? "DEPLOYED"
        : r.availability.status === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : r.availability.status === "LIMITED"
            ? "LIMITED"
            : "AVAILABLE";
    return { id: r.id, name: r.name, kind: r.kind, role: r.role, location: r.location, locality: r.locality, state, missionCode: busy };
  });

  const dispatchDelays = missions
    .filter((m) => m.dispatchedAt)
    .map((m) => {
      const inc = incidents.find((i) => i.id === m.incidentId);
      return inc ? (new Date(m.dispatchedAt!).getTime() - new Date(inc.createdAt).getTime()) / 6e4 : null;
    })
    .filter((x): x is number => x !== null);

  // Hours donated in this operation: elapsed mission time × distinct responders (people and org crews).
  const volunteerHours = missions
    .filter((m) => m.dispatchedAt && m.status !== "CANCELLED" && m.status !== "PROPOSED")
    .reduce((sum, m) => {
      const end = m.completedAt ? new Date(m.completedAt).getTime() : ctx.now.getTime();
      const hours = Math.max(0.5, (end - new Date(m.dispatchedAt!).getTime()) / 36e5);
      return sum + hours * new Set(m.assignments.map((a) => a.responderId)).size;
    }, 0);

  const kpis: Kpis = {
    peopleHelped: summaries.filter((s) => s.status === "RESOLVED").reduce((n, s) => n + s.peopleAffected, 0),
    peopleWaiting: summaries.filter((s) => ["OPEN", "TEAM_FORMING", "ACTIVE"].includes(s.status)).reduce((n, s) => n + s.peopleAffected, 0),
    volunteersDeployed: markers.filter((m) => m.kind === "PERSON" && m.state === "DEPLOYED").length,
    volunteersReady: markers.filter((m) => m.kind === "PERSON" && (m.state === "AVAILABLE" || m.state === "LIMITED")).length,
    organizations: responders.filter((r) => r.kind === "ORGANIZATION").length,
    escalationsRecommended: incidents.reduce((n, i) => n + i.handoffs.length, 0),
    escalationsContacted: incidents.reduce((n, i) => n + i.handoffs.filter((h) => h.status !== "RECOMMENDED").length, 0),
    needsByPath: Object.fromEntries(RESOLUTION_PATHS.map((p) => [p, incidents.reduce((n, i) => n + (i.needs ?? []).filter((x) => x.path === p && x.status !== "NOT_REQUESTED").length, 0)])) as Record<ResolutionPath, number>,
    needsTotal: incidents.reduce((n, i) => n + (i.needs ?? []).filter((x) => x.status !== "NOT_REQUESTED").length, 0),
    needsResolved: incidents.reduce((n, i) => n + (i.needs ?? []).filter((x) => x.status === "RESOLVED").length, 0),
    avgMinutesToDispatch: dispatchDelays.length ? Math.round(dispatchDelays.reduce((a, b) => a + b, 0) / dispatchDelays.length) : null,
    volunteerHours: Math.round(volunteerHours * 10) / 10,
    estimatedValueUsd: Math.round(volunteerHours * VOLUNTEER_HOUR_VALUE),
  };

  const gapCount = new Map<string, number>();
  for (const s of summaries) if (s.status === "OPEN") for (const role of s.unfillableRoles) gapCount.set(role, (gapCount.get(role) ?? 0) + 1);

  return {
    generatedAt: ctx.now.toISOString(),
    operation: config().operationName,
    counts,
    incidents: summaries,
    responders: markers,
    kpis,
    gaps: [...gapCount.entries()].map(([role, n]) => ({ role, incidents: n })),
  };
}

export async function buildIncidentDetail(ctx: Ctx, id: string): Promise<IncidentDetail | null> {
  const incident = await ctx.repo.getIncident(ctx.ws, id);
  if (!incident) return null;
  const [missions, responders] = await Promise.all([ctx.repo.listMissions(ctx.ws), ctx.repo.listResponders(ctx.ws)]);
  const mission = incident.missionId ? missions.find((m) => m.id === incident.missionId) ?? null : null;
  const matches = incident.triage.civilianDispatchAllowed ? matchIncident({ incident, responders, missions, now: ctx.now }) : [];
  const involved = new Set<string>([...matches.flatMap((m) => m.candidates.map((c) => c.responderId)), ...(mission?.assignments.map((a) => a.responderId) ?? [])]);
  const lites: Record<string, ResponderLite> = {};
  for (const r of responders) if (involved.has(r.id)) lites[r.id] = lite(r, ctx.now);
  const summary = summarize(incident, mission ?? undefined, responders, missions, ctx.now);
  const picture = await loadPicture(ctx);
  let dispatchPreview: IncidentDetail["dispatchPreview"] = null;
  let routePreview: IncidentDetail["routePreview"] = null;
  if (mission?.status === "PROPOSED") {
    const base = checkDispatch({ incident, mission, responders, missions, now: ctx.now });
    const ops = await dispatchContext(ctx, incident, mission, responders, picture);
    const checks = [...base.checks, ...ops.checks];
    const ok = checks.every((c) => c.passed);
    // Everything passes except gaps the coordinator may accept (missing optional equipment/roles).
    const partialOk = !ok && checks.every((c) => c.passed || c.acknowledgeable);
    dispatchPreview = { ok, partialOk, checks };
    routePreview = ops.route;
  }
  // Operational evidence linked to this incident (community report, opt-in camera snapshots).
  const evidence = picture.clusters
    .filter((c) => picture.events.some((e) => c.memberIds.includes(e.id) && e.incidentId === incident.id))
    .map((c) => ({
      clusterId: c.id,
      title: c.title,
      status: c.status,
      items: c.evidence,
      media: picture.events.filter((e) => c.memberIds.includes(e.id) && e.incidentId === incident.id && e.camera?.mediaReference).map((e) => ({ eventId: e.id, url: e.camera!.mediaReference!, label: e.title, humanVerified: e.camera!.humanVerified })),
    }));
  const optInCameras =
    ctx.persona.kind === "coordinator"
      ? (await ctx.repo.listCameras(ctx.ws))
          .filter((c) => c.consent && distanceKm(c.location, incident.location) <= 0.4)
          .map((c) => ({
            id: c.id,
            name: c.name,
            active: !c.consent!.revokedAt && (!c.consent!.expiresAt || new Date(c.consent!.expiresAt) > ctx.now),
            scope: c.consent!.scope,
            purpose: c.consent!.purpose,
            expiresAt: c.consent!.expiresAt,
          }))
      : [];
  const navCtx = navigatorContextFor(ctx.ws);
  const services: IncidentDetail["navigator"]["services"] = {};
  for (const id of new Set([...(incident.needs ?? []).flatMap((n) => n.serviceIds), ...incident.handoffs.flatMap((h) => (h.serviceId ? [h.serviceId] : []))])) {
    const s = getService(id);
    if (s) services[id] = { ...s, pending: servicePending(s, navCtx) };
  }
  const vEvidence = scanVulnerabilityEvidence(incident.request.text);
  const considerations = incident.assessment.vulnerabilities.map((v) => ({
    vulnerability: v,
    phrase: vEvidence[v],
    source: vEvidence[v] ? ("TEXT" as const) : incident.request.accessibilityNeeds.includes(v) ? ("FORM" as const) : ("AI" as const),
  }));
  const navigator = { immediatePriority: immediatePriority(incident.needs ?? [], incident.triage), services, considerations };
  const detail: IncidentDetail = { incident, navigator, mission, matches, responders: lites, displayStatus: summary.displayStatus, dispatchPreview, routePreview, evidence, optInCameras };
  return redactDetail(detail, ctx);
}

/**
 * Least privilege for incident detail. Routes start at a volunteer's staging
 * location, and evidence may include an owner's camera snapshot: coordinators
 * see everything; the assigned team sees its route; everyone else sees ETAs only.
 */
function redactDetail(d: IncidentDetail, ctx: Ctx): IncidentDetail {
  if (ctx.persona.kind === "coordinator") return d;
  const onTeam = ctx.persona.kind === "responder" && !!d.mission?.assignments.some((a) => a.responderId === ctx.persona.id);
  const hideRoute = (r?: RoutePlan): RoutePlan | undefined =>
    r && { ...r, origin: { lat: r.destination.lat, lng: r.destination.lng, label: "Team staging area" }, path: [[r.destination.lng, r.destination.lat]], avoided: r.avoided };
  const mission = d.mission && !onTeam ? { ...d.mission, route: hideRoute(d.mission.route), routeHistory: d.mission.routeHistory?.map((r) => hideRoute(r)!) } : d.mission;
  // Handoff summaries are for the coordinator making the contact.
  const incident = { ...d.incident, handoffs: d.incident.handoffs.map((h) => ({ ...h, summary: undefined })) };
  return { ...d, incident, mission, routePreview: null, evidence: [], optInCameras: [] };
}

/** A responder as sent to browsers: without the server-only sign-in key. */
export function publicResponder(r: Responder): Responder {
  const { ownerKey: _ownerKey, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

export async function buildVolunteerView(ctx: Ctx, responderId: string): Promise<VolunteerView | null> {
  const [responder, incidents, missions, responders] = await Promise.all([
    ctx.repo.getResponder(ctx.ws, responderId),
    ctx.repo.listIncidents(ctx.ws),
    ctx.repo.listMissions(ctx.ws),
    ctx.repo.listResponders(ctx.ws),
  ]);
  if (!responder) return null;
  const now = ctx.now;
  const incById = new Map(incidents.map((i) => [i.id, i]));
  const byId = new Map(responders.map((r) => [r.id, r]));
  const sum = (i: Incident, m?: Mission) => summarize(i, m, responders, missions, now);
  const roleFor = (m: Mission, i: Incident) =>
    m.assignments
      .filter((a) => a.responderId === responderId)
      .map((a) => i.requirements.find((s) => s.id === a.slotId)?.label ?? a.slotId)
      .join(" + ");

  const mine = missions.filter((m) => m.assignments.some((a) => a.responderId === responderId));
  const active = mine.find((m) => ["DISPATCHED", "REROUTING", "IN_PROGRESS", "ON_HOLD"].includes(m.status));
  const activeIncident = active ? incById.get(active.incidentId) : undefined;

  // Eligible open incidents: the volunteer passes every gate for at least one role.
  const commitmentsByIncident = new Map<string, ReturnType<typeof computeCommitments>>();
  const eligible: VolunteerView["eligible"] = [];
  let hiddenCount = 0;
  const unlockCount = new Map<string, number>();
  for (const i of incidents) {
    if (i.status !== "OPEN" && i.status !== "TEAM_FORMING") continue;
    const c = commitmentsByIncident.get(i.id) ?? computeCommitments(missions, i.id, responders);
    commitmentsByIncident.set(i.id, c);
    const ctxM = { incident: i, responders, missions, now };
    const evals = i.requirements
      .filter((s) => s.kind === "PERSON" && isInPool(s, responder))
      .map((s) => ({ s, e: evaluateCandidate(s, responder, ctxM, c) }));
    const ok = evals.filter((x) => x.e.eligible);
    if (ok.length) {
      eligible.push({
        incident: sum(i, i.missionId ? missions.find((m) => m.id === i.missionId) : undefined),
        roles: ok.map((x) => x.s.label),
        distanceKm: ok[0].e.distanceKm,
        score: Math.max(...ok.map((x) => x.e.score)),
        offered: i.offers.includes(responderId),
      });
    } else {
      hiddenCount++;
      // What single credential would unlock this incident?
      for (const s of i.requirements.filter((x) => x.kind === "PERSON")) {
        for (const cred of s.credentials) {
          if (!credentialState(responder, cred, now).valid) unlockCount.set(CREDENTIAL_LABELS[cred], (unlockCount.get(CREDENTIAL_LABELS[cred]) ?? 0) + 1);
        }
      }
    }
  }
  eligible.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

  return {
    responder: publicResponder(responder),
    readiness: readinessLevel(responder, now),
    activeMission:
      active && activeIncident
        ? {
            mission: active,
            incident: sum(activeIncident, active),
            briefing: active.briefing?.text,
            role: roleFor(active, activeIncident),
            teammates: active.assignments
              .filter((a) => a.responderId !== responderId)
              .map((a) => ({ name: byId.get(a.responderId)?.name ?? a.responderId, role: activeIncident.requirements.find((s) => s.id === a.slotId)?.label ?? a.slotId })),
          }
        : null,
    proposedMissions: mine
      .filter((m) => m.status === "PROPOSED")
      .flatMap((m) => {
        const i = incById.get(m.incidentId);
        return i ? [{ mission: m, incident: sum(i, m), role: roleFor(m, i) }] : [];
      }),
    eligible,
    hiddenCount,
    unlocks: [...unlockCount.entries()].map(([credential, n]) => ({ credential, incidents: n })).sort((a, b) => b.incidents - a.incidents).slice(0, 4),
    completed: mine
      .filter((m) => m.status === "VERIFIED" || m.status === "COMPLETED")
      .flatMap((m) => {
        const i = incById.get(m.incidentId);
        return i ? [{ mission: m, incident: sum(i, m), role: roleFor(m, i) }] : [];
      }),
  };
}
