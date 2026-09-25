import { z } from "zod";
import { draftHandoffSummary, generateBriefing, interpretRequest } from "@/ai";
import { geocode } from "@/maps/geocode";
import { ASSET_LABELS } from "@/domain/catalog";
import {
  ASSET_TYPES,
  CREDENTIAL_TYPES,
  ESCALATION_TARGETS,
  HAZARDS,
  INCIDENT_CATEGORIES,
  NEEDS,
  TRAINING_MODULES,
  VULNERABILITIES,
  type Incident,
  type IntakeRequest,
  SKILLS,
  type Mission,
  type Responder,
} from "@/domain/types";
import * as life from "@/engine/lifecycle";
import { duplicateAdvisory, findPossibleDuplicates } from "@/engine/dedupe";
import { buildIncident } from "@/engine/pipeline";
import { communityReportFromIncident } from "@/data/scenarioOps";
import { SCENARIO } from "@/data/seed";
import { publishChange } from "@/realtime/pubsub";
import { HttpError, requireCoordinator, type Ctx } from "./context";
import { withWorkspaceLock } from "./lock";
import { dispatchContext, loadPicture, reassessLocked, workspaceMode } from "./ops";

/* ------------------------------------------------------------------ */
/* Intake                                                              */
/* ------------------------------------------------------------------ */

export const intakeSchema = z.object({
  text: z.string().trim().min(8, "Please describe what happened (at least a few words).").max(2000),
  categoryHint: z.enum(INCIDENT_CATEGORIES).optional(),
  locationText: z.string().trim().min(2, "Please give an approximate location.").max(200),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  peopleAffected: z.number().int().min(1).max(500).optional(),
  accessibilityNeeds: z.array(z.enum(VULNERABILITIES)).max(8).default([]),
  immediateDanger: z.boolean().default(false),
  photoDataUrl: z
    .string()
    .max(1_500_000, "Photo is too large.")
    .regex(/^data:image\/(?:jpeg|png|webp);base64,/, "Photo must be a JPEG, PNG or WebP image.")
    .optional(),
  language: z.string().regex(/^[a-z]{2}$/).optional(),
  reporterName: z.string().max(80).optional(),
  reporterRelation: z.enum(["SELF", "FAMILY", "NEIGHBOR", "OTHER"]).optional(),
});

export async function submitIntake(ctx: Ctx, input: unknown): Promise<Incident> {
  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request", parsed.error.issues);
  const request: IntakeRequest = { ...parsed.data };
  // Network work (geocoding, AI interpretation) happens before taking the workspace lock.
  const [place, ai] = await Promise.all([geocode(request.locationText, request.location, { preferService: workspaceMode(ctx.ws) === "LIVE" }), interpretRequest(request)]);
  return withWorkspaceLock(ctx.ws, () => submitIntakeLocked(ctx, request, place, ai));
}

async function submitIntakeLocked(ctx: Ctx, request: IntakeRequest, place: Awaited<ReturnType<typeof geocode>>, ai: Awaited<ReturnType<typeof interpretRequest>>): Promise<Incident> {
  const incidents = await ctx.repo.listIncidents(ctx.ws);
  const maxNum = incidents.reduce((n, i) => Math.max(n, parseInt(i.number.replace(/\D/g, ""), 10) || 0), SCENARIO.firstIncidentNumber);
  const number = `INC-${maxNum + 1}`;
  const incident = buildIncident({
    id: `inc-${crypto.randomUUID().slice(0, 8)}`,
    number,
    workspaceId: ctx.ws,
    source: ctx.persona.kind === "coordinator" ? "COORDINATOR" : "RESIDENT_APP",
    request: {
      ...request,
      reporterName: request.reporterName ?? (ctx.persona.kind === "resident" ? ctx.persona.name : undefined),
      // Known reporter identity keeps community reports independent per person (rule A2).
      reporterId: ctx.persona.kind === "resident" || ctx.persona.kind === "responder" ? ctx.persona.id : undefined,
    },
    location: place.point,
    locality: place.locality,
    locationLabel: place.label,
    interpretation: ai.interpretation,
    raw: ai.raw,
    now: ctx.now,
  });
  if (place.provider === "azure-maps") incident.timeline.splice(1, 0, { at: ctx.now.toISOString(), actor: "system", message: `Azure Maps geocoded “${request.locationText}” → ${place.label}.` });
  // Rule R-A04: flag, never merge, a likely duplicate of an open incident.
  const dup = duplicateAdvisory(findPossibleDuplicates(incident, incidents));
  if (dup) {
    incident.advisories.push(dup);
    incident.timeline.push({ at: ctx.now.toISOString(), actor: "rules", message: dup.message });
  }
  await ctx.repo.saveIncident(incident);
  if (incident.status === "LOGGED") {
    // Rule R-I01: the report joins the operational picture as an unverified community report.
    await ctx.repo.saveEvents([communityReportFromIncident(incident, workspaceMode(ctx.ws))]);
    await reassessLocked(ctx);
  }
  void publishChange(ctx.ws, "incident.created");
  return incident;
}

/* ------------------------------------------------------------------ */
/* Incident actions                                                    */
/* ------------------------------------------------------------------ */

export const incidentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), overrides: z.record(z.string(), z.string()).optional() }),
  z.object({ action: z.literal("ack-advisory"), advisoryId: z.string() }),
  z.object({ action: z.literal("record-contact"), target: z.enum(ESCALATION_TARGETS), note: z.string().max(200).default("") }),
  z.object({ action: z.literal("record-ack"), target: z.enum(ESCALATION_TARGETS), reference: z.string().max(60).default("") }),
  z.object({ action: z.literal("clear-hazard"), hazard: z.enum(HAZARDS), authority: z.string().min(2).max(120), note: z.string().max(300).default("") }),
  z.object({ action: z.literal("offer") }),
  z.object({ action: z.literal("set-needs"), needs: z.array(z.enum(NEEDS)).max(NEEDS.length) }),
  z.object({ action: z.literal("request-help"), needIds: z.array(z.string().max(80)).min(1).max(20) }),
  z.object({ action: z.literal("resolve-need"), needId: z.string().max(80), note: z.string().max(200).default("") }),
  z.object({ action: z.literal("draft-handoff"), target: z.enum(ESCALATION_TARGETS) }),
]);

async function nextMissionNumber(ctx: Ctx): Promise<number> {
  const missions = await ctx.repo.listMissions(ctx.ws);
  return missions.reduce((n, m) => Math.max(n, m.number), SCENARIO.firstMissionNumber - 1) + 1;
}

async function load(ctx: Ctx, incidentId: string) {
  const [incident, missions, responders] = await Promise.all([
    ctx.repo.getIncident(ctx.ws, incidentId),
    ctx.repo.listMissions(ctx.ws),
    ctx.repo.listResponders(ctx.ws),
  ]);
  if (!incident) throw new HttpError(404, "Incident not found");
  const mission = incident.missionId ? missions.find((m) => m.id === incident.missionId) : undefined;
  return { incident, missions, responders, mission };
}

export async function incidentAction(ctx: Ctx, incidentId: string, input: unknown) {
  const parsed = incidentActionSchema.safeParse(input);
  if (parsed.success && parsed.data.action === "draft-handoff") return draftHandoff(ctx, incidentId, parsed.data.target);
  return withWorkspaceLock(ctx.ws, () => incidentActionLocked(ctx, incidentId, input));
}

/** WHAT to hand off: Azure AI Foundry drafts a concise summary (language task) outside the lock; the template is the fallback. */
async function draftHandoff(ctx: Ctx, incidentId: string, target: Incident["handoffs"][number]["target"]) {
  requireCoordinator(ctx);
  const incident = await ctx.repo.getIncident(ctx.ws, incidentId);
  if (!incident) throw new HttpError(404, "Incident not found");
  const h = incident.handoffs.find((x) => x.target === target);
  if (!h) throw new HttpError(404, "No handoff recommended for that destination.");
  const summary = await draftHandoffSummary(incident, h, ctx.now);
  return withWorkspaceLock(ctx.ws, async () => {
    const current = await ctx.repo.getIncident(ctx.ws, incidentId);
    if (!current) throw new HttpError(404, "Incident not found");
    const at = ctx.now.toISOString();
    const updated: Incident = {
      ...current,
      handoffs: current.handoffs.map((x) => (x.target === target ? { ...x, summary } : x)),
      updatedAt: at,
      timeline: [
        ...current.timeline,
        {
          at,
          actor: summary.provider === "azure-ai-foundry" ? "ai" : "rules",
          message: `Handoff summary for ${target.replace(/_/g, " ").toLowerCase()} ${summary.provider === "azure-ai-foundry" ? `drafted by Azure AI Foundry (${summary.model})` : "prepared from the template (Foundry unavailable)"}. Nothing was sent.`,
        },
      ],
    };
    await ctx.repo.saveIncident(updated);
    void publishChange(ctx.ws, "incident.draft-handoff");
    return { incident: updated };
  });
}

async function incidentActionLocked(ctx: Ctx, incidentId: string, input: unknown): Promise<{ incident: Incident; mission?: Mission; rejectedOverrides?: unknown }> {
  const parsed = incidentActionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid action", parsed.error.issues);
  const a = parsed.data;
  const { incident, missions, responders, mission } = await load(ctx, incidentId);

  switch (a.action) {
    case "propose": {
      requireCoordinator(ctx);
      const res = life.proposeTeam({
        incident,
        existing: mission,
        responders,
        missions,
        missionNumber: mission?.status === "PROPOSED" ? mission.number : await nextMissionNumber(ctx),
        overrides: a.overrides,
        actor: a.overrides && Object.keys(a.overrides).length ? ctx.persona.name : "engine",
        now: ctx.now,
      });
      await ctx.repo.saveMission(res.mission);
      await ctx.repo.saveIncident(res.incident);
      void publishChange(ctx.ws, "mission.proposed");
      return res;
    }
    case "ack-advisory": {
      requireCoordinator(ctx);
      const updated = life.acknowledgeAdvisory(incident, a.advisoryId, ctx.persona.name, ctx.now);
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
    case "record-contact":
    case "record-ack": {
      requireCoordinator(ctx);
      const updated =
        a.action === "record-contact"
          ? life.recordHandoffContact(incident, a.target, ctx.persona.name, a.note, ctx.now)
          : life.recordHandoffAcknowledgement(incident, a.target, ctx.persona.name, a.reference, ctx.now);
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
    case "clear-hazard": {
      requireCoordinator(ctx);
      const updated = life.clearHazard(incident, a.hazard, a.authority, a.note || "hazard made safe", ctx.persona.name, ctx.now);
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
    case "set-needs": {
      requireCoordinator(ctx);
      if (mission && mission.status === "PROPOSED") throw new HttpError(409, `Cancel or dispatch ${mission.code} before changing needs.`);
      const updated = life.setNeeds(incident, a.needs, ctx.persona.name, ctx.now);
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
    case "request-help": {
      // Rule N-15: the reporting resident, or a coordinator on their behalf (e.g. a phone request).
      const isReporter = ctx.persona.kind === "resident" && (!incident.request.reporterId || incident.request.reporterId === ctx.persona.id);
      if (ctx.persona.kind !== "coordinator" && !isReporter) throw new HttpError(403, "Only the person who asked for help, or a coordinator on their behalf, can request coordinated help.");
      const updated = life.requestCommunityHelp(incident, a.needIds, ctx.persona.name, ctx.persona.kind === "coordinator" ? "coordinator" : "resident", ctx.now);
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
    case "resolve-need": {
      requireCoordinator(ctx);
      const updated = life.resolveNeedRecord(incident, a.needId, ctx.persona.name, a.note, ctx.now);
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
    case "draft-handoff":
      throw new HttpError(400, "Unexpected action");
    case "offer": {
      if (ctx.persona.kind !== "responder") throw new HttpError(403, "Switch to a volunteer persona to offer help.");
      if (incident.offers.includes(ctx.persona.id)) return { incident };
      const at = ctx.now.toISOString();
      const updated: Incident = {
        ...incident,
        offers: [...incident.offers, ctx.persona.id],
        updatedAt: at,
        timeline: [...incident.timeline, { at, actor: "volunteer", message: `${ctx.persona.name} offered to help (volunteer dashboard).` }],
      };
      await ctx.repo.saveIncident(updated);
      void publishChange(ctx.ws, `incident.${a.action}`);
      return { incident: updated };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mission actions                                                     */
/* ------------------------------------------------------------------ */

export const missionActionSchema = z.object({
  action: z.enum(["dispatch", "start", "complete", "verify", "cancel", "ack-route", "resume"]),
  note: z.string().max(500).optional(),
  /** Dispatch only: go without unfilled optional roles/equipment (explicit coordinator acknowledgement). */
  allowPartial: z.boolean().optional(),
});

export async function missionAction(ctx: Ctx, missionId: string, input: unknown): Promise<{ incident: Incident; mission: Mission }> {
  const result = await withWorkspaceLock(ctx.ws, () => missionActionLocked(ctx, missionId, input));
  // The briefing is a slow language task: draft it after the dispatch is committed, outside the lock.
  if (result.mission.status === "DISPATCHED" && !result.mission.briefing) {
    const responders = await ctx.repo.listResponders(ctx.ws);
    const briefing = await generateBriefing(result.incident, result.mission, responders);
    await withWorkspaceLock(ctx.ws, async () => {
      const latest = await ctx.repo.getMission(ctx.ws, result.mission.id);
      if (latest && !latest.briefing) await ctx.repo.saveMission({ ...latest, briefing });
    });
    result.mission = { ...result.mission, briefing };
    void publishChange(ctx.ws, "mission.briefing");
  }
  return result;
}

async function missionActionLocked(ctx: Ctx, missionId: string, input: unknown): Promise<{ incident: Incident; mission: Mission }> {
  const parsed = missionActionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid action", parsed.error.issues);
  const { action, note, allowPartial } = parsed.data;
  // Field transitions re-check the operational picture first, so a new or returning hold applies before anyone moves.
  if (action === "start" || action === "complete" || action === "resume" || action === "ack-route") await reassessLocked(ctx);
  const mission = await ctx.repo.getMission(ctx.ws, missionId);
  if (!mission) throw new HttpError(404, "Mission not found");
  const { incident, missions, responders } = await load(ctx, mission.incidentId);
  const onTeam = ctx.persona.kind === "responder" && mission.assignments.some((x) => x.responderId === ctx.persona.id);

  let result: { incident: Incident; mission: Mission };
  switch (action) {
    case "dispatch": {
      requireCoordinator(ctx);
      // The gate also checks the operational picture: a usable route, no hold condition at the site.
      const picture = await loadPicture(ctx);
      const { route, checks } = await dispatchContext(ctx, incident, mission, responders, picture);
      const d = life.dispatch({ incident, mission, responders, missions, actorName: ctx.persona.name, extraChecks: checks, allowPartial, note, now: ctx.now });
      result = route ? life.attachRoute(d.incident, d.mission, route, ctx.now) : d;
      break;
    }
    case "ack-route":
      if (!onTeam && ctx.persona.kind !== "coordinator") throw new HttpError(403, "Only the assigned team or a coordinator can acknowledge the route.");
      result = life.acknowledgeRoute(incident, mission, ctx.persona.name, ctx.now);
      break;
    case "resume":
      requireCoordinator(ctx);
      result = life.resumeMission(incident, mission, ctx.persona.name, ctx.now);
      break;
    case "start":
      if (!onTeam && ctx.persona.kind !== "coordinator") throw new HttpError(403, "Only the assigned team or a coordinator can update this mission.");
      result = life.startMission(incident, mission, ctx.persona.name, ctx.now);
      break;
    case "complete":
      if (!onTeam && ctx.persona.kind !== "coordinator") throw new HttpError(403, "Only the assigned team or a coordinator can update this mission.");
      result = life.completeMission(incident, mission, ctx.persona.name, note?.trim() || "Work completed.", ctx.now);
      break;
    case "verify": {
      if (ctx.persona.kind !== "coordinator" && ctx.persona.kind !== "resident") throw new HttpError(403, "Completion is verified by the coordinator or the resident, not the team.");
      if (ctx.persona.kind === "resident" && incident.request.reporterId !== ctx.persona.id) throw new HttpError(403, "Residents can only confirm help on their own requests.");
      const v = life.verifyMission({
        incident,
        mission,
        responders,
        by: ctx.persona.kind === "resident" ? `${ctx.persona.name} (resident)` : ctx.persona.name,
        byRole: ctx.persona.kind,
        note: note?.trim() ?? "",
        now: ctx.now,
      });
      for (const r of v.responders) await ctx.repo.saveResponder(r);
      result = v;
      break;
    }
    case "cancel":
      requireCoordinator(ctx);
      result = life.cancelMission(incident, mission, ctx.persona.name, note?.trim() ?? "", ctx.now);
      break;
  }
  await ctx.repo.saveMission(result.mission);
  await ctx.repo.saveIncident(result.incident);
  void publishChange(ctx.ws, `mission.${action}`);
  return result;
}

/* ------------------------------------------------------------------ */
/* Responder actions                                                   */
/* ------------------------------------------------------------------ */

export const responderActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("availability"), status: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]), note: z.string().max(120).optional() }),
  z.object({ action: z.literal("complete-training"), moduleId: z.enum(TRAINING_MODULES) }),
  z.object({ action: z.literal("submit-credential"), type: z.enum(CREDENTIAL_TYPES), issuer: z.string().min(2).max(120), reference: z.string().max(60).optional() }),
  z.object({ action: z.literal("verify-credential"), type: z.enum(CREDENTIAL_TYPES) }),
  z.object({ action: z.literal("verify-identity") }),
]);

export async function responderAction(ctx: Ctx, responderId: string, input: unknown) {
  return withWorkspaceLock(ctx.ws, () => responderActionLocked(ctx, responderId, input));
}

async function responderActionLocked(ctx: Ctx, responderId: string, input: unknown) {
  const parsed = responderActionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid action", parsed.error.issues);
  const a = parsed.data;
  const r = await ctx.repo.getResponder(ctx.ws, responderId);
  if (!r) throw new HttpError(404, "Responder not found");
  const self = ctx.persona.kind === "responder" && ctx.persona.id === responderId;
  if (!self && ctx.persona.kind !== "coordinator") throw new HttpError(403, "You can only update your own profile.");
  const at = ctx.now.toISOString();

  switch (a.action) {
    case "availability":
      r.availability = { status: a.status, note: a.note };
      break;
    case "complete-training":
      if (!r.training.some((t) => t.moduleId === a.moduleId)) r.training.push({ moduleId: a.moduleId, completedAt: at });
      break;
    case "submit-credential":
      // Keep verified/expired/revoked history; a new upload replaces only an older pending one.
      r.credentials = r.credentials.filter((c) => !(c.type === a.type && c.status === "PENDING"));
      r.credentials.push({ type: a.type, status: "PENDING", issuer: a.issuer, reference: a.reference });
      break;
    case "verify-identity":
      // A coordinator checked the volunteer's identity (e.g. photo ID in person). Required before any mission.
      requireCoordinator(ctx);
      r.identityVerified = true;
      break;
    case "verify-credential": {
      requireCoordinator(ctx);
      const c = r.credentials.find((x) => x.type === a.type && x.status === "PENDING");
      if (!c) throw new HttpError(404, "No pending record of that credential to verify.");
      c.status = "VERIFIED";
      c.verifiedAt = at;
      c.verifiedBy = `${ctx.persona.name} (coordinator)`;
      c.expiresAt = new Date(ctx.now.getTime() + 365 * 864e5).toISOString();
      break;
    }
  }
  await ctx.repo.saveResponder(r);
  void publishChange(ctx.ws, `responder.${a.action}`);
  return r;
}

/* ------------------------------------------------------------------ */
/* Volunteer registration                                              */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  locationText: z.string().trim().min(2).max(160),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  maxTravelKm: z.number().int().min(1).max(150),
  skills: z.array(z.enum(SKILLS)).max(SKILLS.length),
  assets: z.array(z.object({ type: z.enum(ASSET_TYPES), label: z.string().trim().max(80).optional(), quantity: z.number().int().min(1).max(1000).default(1) })).max(20),
  languages: z.array(z.string().trim().min(2).max(30)).max(6).default(["English"]),
});

/**
 * A volunteer registers themselves. The profile starts unverified: a coordinator must verify
 * identity (and any credentials) before the matching gates will ever select them.
 */
export async function registerVolunteer(ctx: Ctx, input: unknown, ownerKey: string): Promise<Responder> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid registration", parsed.error.issues);
  const a = parsed.data;
  const place = await geocode(a.locationText, a.location, { preferService: workspaceMode(ctx.ws) === "LIVE" });
  const id = `r-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const at = ctx.now.toISOString();
  const r: Responder = {
    id,
    workspaceId: ctx.ws,
    kind: "PERSON",
    role: a.skills.some((k) => k !== "GENERAL_LABOR") ? "TRAINED_VOLUNTEER" : "GENERAL_VOLUNTEER",
    name: a.name,
    headline: "Registered volunteer",
    locality: place.locality,
    location: place.point,
    maxTravelKm: a.maxTravelKm,
    identityVerified: false,
    skills: a.skills.length ? a.skills : ["GENERAL_LABOR"],
    credentials: [],
    training: [],
    assets: a.assets.map((x, i) => ({ id: `${id}-a${i + 1}`, type: x.type, label: x.label || ASSET_LABELS[x.type], quantity: x.quantity })),
    languages: a.languages,
    accessibilitySupport: [],
    availability: { status: "AVAILABLE" },
    stats: { missionsCompleted: 0, hoursContributed: 0 },
    ownerKey,
    registeredAt: at,
  };
  await withWorkspaceLock(ctx.ws, () => ctx.repo.saveResponder(r));
  void publishChange(ctx.ws, "responder.registered");
  return r;
}
