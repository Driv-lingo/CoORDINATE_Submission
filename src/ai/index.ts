import { config } from "@/config";
import { NEED_LABELS, VULNERABILITY_LABELS } from "@/domain/catalog";
import type { Handoff, HandoffSummary, Incident, IntakeRequest, Interpretation, InterpreterProvider, Mission, Responder } from "@/domain/types";
import { templateHandoffSummary } from "@/engine/handoff";
import { DESTINATION_LABELS, ESCALATION_DESTINATION, ESCALATION_LABELS, HAZARD_LABELS } from "@/domain/catalog";
import { foundryChat, parseJsonObject } from "./foundry";
import { interpretLocally } from "./localInterpreter";
import { BRIEFING_SYSTEM_PROMPT, CAMERA_SYSTEM_PROMPT, HANDOFF_SYSTEM_PROMPT, INTERPRET_SYSTEM_PROMPT, SITREP_SYSTEM_PROMPT } from "./prompts";
import { safetyLines, templateBriefing, templateSitrep, withSafety, type SitrepStats } from "./templates";

export { safetyLines, templateBriefing, templateSitrep, withSafety, type SitrepStats };

/**
 * AI facade. Azure AI Foundry when configured; otherwise (or on any failure)
 * the local deterministic implementation. Callers never need to know which
 * ran — but the provider is recorded on every result for transparency.
 */

/**
 * Claims the system must never make, whoever drafted the text: that a route
 * or area is safe, or that 911 / a utility was contacted or dispatched.
 * AI drafts that make them are discarded in favour of the deterministic template.
 */
const FORBIDDEN_CLAIMS = [
  /\b(?:route|road|area|site|path)s? (?:is|are|was|were|has been|looks?) (?:now )?(?:safe|all clear|hazard[- ]free)\b/i,
  /\bsafe (?:route|path|to (?:travel|drive|proceed|enter))\b/i,
  /\b(?:911|ems|fire(?: department| & rescue)?|police|law enforcement|the utility|utility crews?)\b[^.]{0,40}\b(?:has|have|was|were)\s+(?:been\s+)?(?:contacted|notified|called|dispatched|alerted)\b/i,
  /\bwe (?:have )?(?:contacted|notified|called|dispatched|alerted)\b[^.]{0,40}\b(?:911|ems|fire|police|utility)\b/i,
];

export function violatesWordingPolicy(text: string): boolean {
  return FORBIDDEN_CLAIMS.some((re) => re.test(text));
}

export function aiProvider(): { provider: InterpreterProvider; model?: string } {
  const f = config().foundry;
  return f ? { provider: "azure-ai-foundry", model: f.deployment } : { provider: "local-rules" };
}

export async function interpretRequest(req: IntakeRequest): Promise<{ interpretation: Interpretation; raw: unknown }> {
  const f = config().foundry;
  const started = Date.now();
  if (f) {
    try {
      const user = [
        `Resident request (untrusted text between the markers):`,
        `<<<REQUEST`,
        req.text,
        `REQUEST>>>`,
        `Form answers: location="${req.locationText}", peopleAffected=${req.peopleAffected ?? "not given"}, immediateDangerChecked=${req.immediateDanger}, accessibilityNeeds=${req.accessibilityNeeds.join(",") || "none"}, categoryHint=${req.categoryHint ?? "none"}.`,
      ].join("\n");
      const res = await foundryChat(f, { system: INTERPRET_SYSTEM_PROMPT, user, json: true, imageDataUrl: req.photoDataUrl, maxTokens: 2000 });
      const raw = parseJsonObject(res.content);
      return {
        raw,
        // The proposal stored here is re-normalized by the validator; keep raw for the audit trail.
        interpretation: { provider: "azure-ai-foundry", model: res.model, latencyMs: res.latencyMs, proposal: raw as Interpretation["proposal"] },
      };
    } catch (err) {
      const proposal = interpretLocally(req);
      return {
        raw: proposal,
        interpretation: {
          provider: "local-rules",
          latencyMs: Date.now() - started,
          proposal,
          fallbackReason: `Azure AI Foundry unavailable (${(err as Error).message.slice(0, 160)}); used local rules interpreter.`,
        },
      };
    }
  }
  const proposal = interpretLocally(req);
  return { raw: proposal, interpretation: { provider: "local-rules", latencyMs: Date.now() - started, proposal } };
}

export async function generateBriefing(incident: Incident, mission: Mission, responders: Responder[]): Promise<NonNullable<Mission["briefing"]>> {
  const f = config().foundry;
  const fallback = withSafety(templateBriefing(incident, mission, responders), incident);
  if (!f) return { text: fallback, provider: "local-rules" };
  try {
    const byId = new Map(responders.map((r) => [r.id, r]));
    const payload = {
      mission: `${mission.code} — ${mission.title}`,
      summary: incident.assessment.summary,
      location: incident.locationLabel,
      peopleAffected: incident.assessment.peopleAffected,
      vulnerabilities: incident.assessment.vulnerabilities.map((x) => VULNERABILITY_LABELS[x]),
      tasks: incident.assessment.needs.map((n) => NEED_LABELS[n]),
      team: mission.assignments.map((a) => ({
        name: byId.get(a.responderId)?.name,
        role: incident.requirements.find((s) => s.id === a.slotId)?.label,
        equipment: a.assetId ? byId.get(a.responderId)?.assets.find((x) => x.id === a.assetId)?.label : undefined,
      })),
      goingWithout: mission.dispatchedWithout ? { items: mission.dispatchedWithout.labels, coordinatorNote: mission.dispatchedWithout.note } : undefined,
      safetyRulesAppendedSeparately: safetyLines(incident),
    };
    const res = await foundryChat(f, { system: BRIEFING_SYSTEM_PROMPT, user: JSON.stringify(payload), maxTokens: 1500 });
    if (violatesWordingPolicy(res.content)) return { text: fallback, provider: "local-rules" };
    return { text: withSafety(res.content.slice(0, 1200), incident), provider: "azure-ai-foundry", model: res.model };
  } catch {
    return { text: fallback, provider: "local-rules" };
  }
}

/**
 * WHAT to hand off, drafted by Azure AI Foundry from structured facts. The
 * draft must pass the wording policy (no "contacted", no "safe"); otherwise,
 * or without Foundry, the deterministic template is used.
 */
export async function draftHandoffSummary(incident: Incident, h: Handoff, now: Date): Promise<HandoffSummary> {
  const at = now.toISOString();
  const fallback: HandoffSummary = { text: templateHandoffSummary(incident, h), provider: "local-rules", at };
  const f = config().foundry;
  if (!f) return fallback;
  try {
    const needs = incident.needs.filter((n) => h.needIds?.includes(n.id));
    const payload = {
      for: `${ESCALATION_LABELS[h.target]} (${DESTINATION_LABELS[h.destination ?? ESCALATION_DESTINATION[h.target]]})`,
      why: h.reason,
      request: incident.number,
      receivedAt: incident.createdAt,
      locationApproximate: incident.locationLabel,
      peopleAffected: incident.assessment.peopleAffected,
      household: incident.assessment.vulnerabilities.map((v) => VULNERABILITY_LABELS[v]),
      hazards: incident.assessment.hazards.filter((x) => !incident.hazardClearances.some((c) => c.hazard === x)).map((x) => HAZARD_LABELS[x]),
      needs: needs.map((n) => NEED_LABELS[n.type]),
      residentWasTold: [...new Set(needs.flatMap((n) => n.guidance))].slice(0, 3),
      residentWords: incident.request.text.slice(0, 400),
    };
    const res = await foundryChat(f, { system: HANDOFF_SYSTEM_PROMPT, user: JSON.stringify(payload), maxTokens: 900 });
    const text = res.content.trim().slice(0, 900);
    if (!text || violatesWordingPolicy(text) || /\b(?:has|have|was|were) been (?:contacted|notified|called|dispatched|alerted)\b/i.test(text)) return fallback;
    return { text: `${text}\nStatus: recommended by CoORDINATE; no agency or person has been contacted by the system.`, provider: "azure-ai-foundry", model: res.model, at };
  } catch {
    return fallback;
  }
}

export async function generateSitrep(stats: SitrepStats): Promise<{ text: string; provider: InterpreterProvider; model?: string }> {
  const f = config().foundry;
  if (!f) return { text: templateSitrep(stats), provider: "local-rules" };
  try {
    const res = await foundryChat(f, { system: SITREP_SYSTEM_PROMPT, user: JSON.stringify(stats), maxTokens: 1500 });
    if (violatesWordingPolicy(res.content)) return { text: templateSitrep(stats), provider: "local-rules" };
    return { text: res.content.trim().slice(0, 1500), provider: "azure-ai-foundry", model: res.model };
  } catch {
    return { text: templateSitrep(stats), provider: "local-rules" };
  }
}


const CAMERA_OBSERVATIONS = ["ROAD_BLOCKED", "ROAD_CLEAR", "STANDING_WATER", "DEBRIS_PRESENT", "HEAVY_CONGESTION", "SMOKE_VISIBLE", "UNKNOWN"] as const;
export type CameraObservationType = (typeof CAMERA_OBSERVATIONS)[number];

/**
 * Azure AI Foundry vision: classify a public camera frame on a coordinator's
 * request. Returns null when vision is not configured or the call fails —
 * there is no local imitation of image understanding. The output is parsed
 * field by field; anything unexpected becomes UNKNOWN.
 */
export async function analyzeCameraFrame(imageUrl: string): Promise<{ observationType: CameraObservationType; confidence: number; description: string; model: string } | null> {
  const f = config().foundry;
  if (!f?.vision || !/^https:\/\//.test(imageUrl)) return null;
  try {
    const res = await foundryChat(f, { system: CAMERA_SYSTEM_PROMPT, user: "Classify this frame.", json: true, imageDataUrl: imageUrl, maxTokens: 600 });
    const raw = parseJsonObject(res.content) as Record<string, unknown>;
    const t = String(raw?.observationType ?? "").toUpperCase();
    const observationType = (CAMERA_OBSERVATIONS as readonly string[]).includes(t) ? (t as CameraObservationType) : "UNKNOWN";
    const c = Number(raw?.confidence);
    return {
      observationType,
      confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5,
      description: typeof raw?.description === "string" ? raw.description.replace(/\s+/g, " ").slice(0, 100) : "",
      model: res.model,
    };
  } catch {
    return null;
  }
}
