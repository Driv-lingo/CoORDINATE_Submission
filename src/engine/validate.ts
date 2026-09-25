import { CATEGORY_LABELS, HAZARD_LABELS, NEED_LABELS, VULNERABILITY_LABELS } from "@/domain/catalog";
import {
  HAZARDS,
  INCIDENT_CATEGORIES,
  NEEDS,
  VULNERABILITIES,
  type Assessment,
  type HazardMention,
  type IncidentCategory,
  type IncidentProposal,
  type IntakeRequest,
  type NeedType,
  type ValidationNote,
} from "@/domain/types";
import { assertedHazards, mentionsPersonalNeed, scanInformationOnly, scanNeeds, scanVulnerabilities, unique } from "./textScan";

/**
 * Deterministic validation of an AI-proposed incident.
 *
 * The model's output is treated as untrusted input: unknown enum values are
 * dropped, numbers are clamped, and safety-relevant fields are merged with the
 * deterministic scanners and the resident's own answers so the AI can only
 * ever ADD risk, never remove it.
 */

const CATEGORY_DEFAULT_NEED: Partial<Record<IncidentCategory, NeedType>> = {
  DEBRIS_CLEARANCE: "DEBRIS_REMOVAL",
  FLOOD_ASSISTANCE: "WATER_MITIGATION",
  ROOF_DAMAGE: "ROOF_TARP",
  SUPPLY_DELIVERY: "FOOD",
  POWER_NEEDS: "DEVICE_CHARGING",
  TRANSPORTATION: "TRANSPORTATION",
  WELLNESS_CHECK: "WELLNESS_CHECK",
  SHELTER: "SHELTER",
};

/** Coerce a model field into a string list: arrays pass through, a lone string is wrapped, anything else is empty. */
function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" || typeof x === "number").map(String);
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

function pickEnum<T extends string>(values: readonly T[], input: unknown, field: string, notes: ValidationNote[], rejected?: string[]): T[] {
  const out: T[] = [];
  for (const raw of stringList(input)) {
    const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_") as T;
    if ((values as readonly string[]).includes(v)) out.push(v);
    else {
      rejected?.push(raw.slice(0, 40));
      notes.push({ field, kind: "REJECTED", message: `Dropped unknown ${field} value “${raw.slice(0, 40)}” from AI output.` });
    }
  }
  return unique(out);
}

export interface ValidationOutcome {
  proposal: IncidentProposal;
  assessment: Assessment;
  notes: ValidationNote[];
  /** Hazard strings the AI reported that are not in the vocabulary — a human must review them. */
  unrecognizedHazards: string[];
  /** Phrases the AI quoted as evidence for each need — kept only if they appear in the request text. */
  aiEvidence: Partial<Record<NeedType, string>>;
}

/** Needs only the navigator derives (from hazards, triage or the report type). */
const DERIVED_ONLY: NeedType[] = ["EMERGENCY_RESPONSE", "HAZARD_RESPONSE", "ROAD_CONDITION", "GENERAL_GUIDANCE"];

/** Navigator needs found by the scanner are always kept: they only add guidance, referrals or a human follow-up. */
const NAVIGATOR_NEEDS: NeedType[] = ["SHELTER", "UTILITY_OUTAGE", "DISASTER_ASSISTANCE", "RECOVERY_CASEWORK", "EMOTIONAL_SUPPORT"];

const squash = (t: string) => t.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();

/**
 * The AI's need evidence: [{ need, quote }]. A quote counts only if it is
 * really in the resident's words — a model can't invent support for a need.
 */
export function validateNeedEvidence(raw: unknown, text: string, needs: NeedType[], notes: ValidationNote[]): Partial<Record<NeedType, string>> {
  const out: Partial<Record<NeedType, string>> = {};
  if (!Array.isArray(raw)) return out;
  const hay = squash(text);
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const need = String((item as Record<string, unknown>).need ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_") as NeedType;
    const quote = String((item as Record<string, unknown>).quote ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!needs.includes(need) || !quote || out[need]) continue;
    if (hay.includes(squash(quote))) out[need] = quote;
    else notes.push({ field: "needEvidence", kind: "REJECTED", message: `AI evidence “${quote.slice(0, 60)}” for ${NEED_LABELS[need]} is not in the request text; ignored.` });
  }
  return out;
}

/**
 * Normalize raw model output into a well-formed proposal (no merging yet).
 * Each field is read independently, so one malformed or null field can never
 * discard the rest — in particular, never the hazards.
 */
export function normalizeProposal(raw: unknown, notes: ValidationNote[] = [], unrecognizedHazards: string[] = []): IncidentProposal {
  const isObject = typeof raw === "object" && raw !== null && !Array.isArray(raw);
  if (!isObject) notes.push({ field: "proposal", kind: "REJECTED", message: "AI output was not a JSON object; relying on deterministic scanners." });
  const p = (isObject ? raw : {}) as Record<string, unknown>;

  let category: IncidentCategory = "OTHER";
  const catRaw = typeof p.category === "string" ? p.category.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
  if ((INCIDENT_CATEGORIES as readonly string[]).includes(catRaw)) category = catRaw as IncidentCategory;
  else if (catRaw) notes.push({ field: "category", kind: "REJECTED", message: `Unknown category “${String(p.category).slice(0, 40)}” replaced with OTHER.` });

  let people = typeof p.peopleAffected === "number" || typeof p.peopleAffected === "string" ? Number(p.peopleAffected) : NaN;
  if (!Number.isFinite(people) || people < 1) people = 1;
  if (people > 500) {
    notes.push({ field: "peopleAffected", kind: "CORRECTED", message: `People affected clamped from ${people} to 500.` });
    people = 500;
  }

  let confidence = typeof p.confidence === "number" || typeof p.confidence === "string" ? Number(p.confidence) : NaN;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  const lifeThreat = p.immediateLifeThreat === true || String(p.immediateLifeThreat).toLowerCase() === "true";

  return {
    category,
    summary: typeof p.summary === "string" ? p.summary.replace(/\s+/g, " ").trim().slice(0, 200) : "",
    peopleAffected: Math.round(people),
    hazards: pickEnum(HAZARDS, p.hazards, "hazards", notes, unrecognizedHazards),
    immediateLifeThreat: lifeThreat,
    vulnerabilities: pickEnum(VULNERABILITIES, p.vulnerabilities, "vulnerabilities", notes),
    needs: pickEnum(NEEDS, p.needs, "needs", notes),
    requestedHelp: stringList(p.requestedHelp).map((s) => s.replace(/\s+/g, " ").trim().slice(0, 80)).filter(Boolean).slice(0, 8),
    language: typeof p.language === "string" && /^[a-z]{2}$/i.test(p.language) ? p.language.toLowerCase() : "en",
    confidence,
  };
}

/** Needs that carry a credential or safety requirement: the scanner's findings are always kept, whatever the AI says. */
const SAFETY_RELEVANT_NEEDS: NeedType[] = ["TREE_CUTTING", "ROOF_TARP", "MEDICATION", "WELLNESS_CHECK", "POWER_MEDICAL_DEVICE", "TRANSPORTATION", "MUCK_OUT", "WATER_MITIGATION", "GENERATOR_POWER"];

/** Needs that merely describe a road/area condition in an information-only report. */
const ROAD_CONDITION_NEEDS: NeedType[] = ["TREE_CUTTING", "DEBRIS_REMOVAL", "ACCESS_BLOCKED", "WATER_MITIGATION"];

export function validateProposal(raw: unknown, request: IntakeRequest, mentions: HazardMention[]): ValidationOutcome {
  const notes: ValidationNote[] = [];
  const unrecognizedHazards: string[] = [];
  const proposal = normalizeProposal(raw, notes, unrecognizedHazards);

  // Category: the resident's explicit choice wins over the model.
  let category = proposal.category;
  if (request.categoryHint && request.categoryHint !== proposal.category) {
    notes.push({
      field: "category",
      kind: "KEPT_RESIDENT_VALUE",
      message: `Resident selected “${CATEGORY_LABELS[request.categoryHint]}”; AI suggested “${CATEGORY_LABELS[proposal.category]}”. Kept resident's choice.`,
    });
    category = request.categoryHint;
  }

  let peopleAffected = proposal.peopleAffected;
  if (request.peopleAffected && request.peopleAffected !== proposal.peopleAffected) {
    notes.push({
      field: "peopleAffected",
      kind: "KEPT_RESIDENT_VALUE",
      message: `Resident reported ${request.peopleAffected} affected; AI estimated ${proposal.peopleAffected}. Kept resident's number.`,
    });
    peopleAffected = request.peopleAffected;
  }

  // Hazards: union of AI + deterministic scanner. The AI can never remove a scanned hazard.
  const scanned = assertedHazards(mentions);
  const hazards = unique([...proposal.hazards, ...scanned]);
  for (const h of scanned) {
    if (!proposal.hazards.includes(h)) {
      const phrase = mentions.find((m) => m.hazard === h && !m.negated)?.phrase ?? "";
      notes.push({
        field: "hazards",
        kind: "ADDED",
        message: `Safety scanner matched “${phrase}” → added ${HAZARD_LABELS[h]} (not flagged by AI).`,
      });
    }
  }

  const immediateLifeThreat = request.immediateDanger || proposal.immediateLifeThreat;
  if (request.immediateDanger && !proposal.immediateLifeThreat) {
    notes.push({ field: "immediateLifeThreat", kind: "KEPT_RESIDENT_VALUE", message: "Resident reported immediate danger. Kept regardless of AI assessment." });
  }

  // Vulnerabilities: union of AI, resident form, and scanner.
  const scannedV = scanVulnerabilities(request.text);
  const vulnerabilities = unique([...proposal.vulnerabilities, ...request.accessibilityNeeds, ...scannedV]);
  const language = request.language && request.language !== "en" ? request.language : proposal.language;
  if (language !== "en" && !vulnerabilities.includes("LANGUAGE_ACCESS")) vulnerabilities.push("LANGUAGE_ACCESS");
  for (const v of vulnerabilities) {
    if (!proposal.vulnerabilities.includes(v)) {
      const source = request.accessibilityNeeds.includes(v) ? "resident form" : "deterministic scan";
      notes.push({ field: "vulnerabilities", kind: "ADDED", message: `Added ${VULNERABILITY_LABELS[v]} (${source}).` });
    }
  }

  // Needs: AI is primary; the deterministic scanner fills in when the AI returned none,
  // and its safety-relevant findings (credentialed roles) are always kept, so the AI
  // cannot lower the tier by omitting e.g. tree cutting.
  let needs = proposal.needs.filter((n) => !DERIVED_ONLY.includes(n));
  for (const n of proposal.needs.filter((x) => DERIVED_ONLY.includes(x))) {
    notes.push({ field: "needs", kind: "REJECTED", message: `${NEED_LABELS[n]} is decided by the safety and navigator rules, not proposed by the AI; dropped.` });
  }
  const scannedNeeds = scanNeeds(request.text);
  if (needs.length === 0) {
    needs = scannedNeeds;
    if (needs.length) notes.push({ field: "needs", kind: "ADDED", message: `AI returned no needs; keyword scan found: ${needs.map((n) => NEED_LABELS[n]).join(", ")}.` });
  } else {
    const kept = scannedNeeds.filter((n) => SAFETY_RELEVANT_NEEDS.includes(n) && !needs.includes(n));
    if (kept.length) {
      needs = [...needs, ...kept];
      notes.push({ field: "needs", kind: "ADDED", message: `Keyword scan found safety-relevant need(s) the AI omitted: ${kept.map((n) => NEED_LABELS[n]).join(", ")}.` });
    }
    const nav = scannedNeeds.filter((n) => NAVIGATOR_NEEDS.includes(n) && !needs.includes(n));
    if (nav.length) {
      needs = [...needs, ...nav];
      notes.push({ field: "needs", kind: "ADDED", message: `Keyword scan found assistance need(s) the AI omitted: ${nav.map((n) => NEED_LABELS[n]).join(", ")}.` });
    }
  }

  // Rule R-I01: information-only road/area reports. Deterministic only — the AI's
  // category alone can never turn a request into "information only" (a de-escalation).
  const informationOnly =
    !immediateLifeThreat &&
    hazards.length === 0 &&
    vulnerabilities.every((v) => v === "LANGUAGE_ACCESS") &&
    !mentionsPersonalNeed(request.text) &&
    (scanInformationOnly(request.text) || request.categoryHint === "ROAD_CONDITION_REPORT") &&
    needs.every((n) => ROAD_CONDITION_NEEDS.includes(n));
  if (informationOnly) {
    if (category !== "ROAD_CONDITION_REPORT") notes.push({ field: "category", kind: "CORRECTED", message: `Reporter describes a road/area condition and asks for no help → Road / area condition report (rule R-I01).` });
    category = "ROAD_CONDITION_REPORT";
    if (needs.length) {
      notes.push({ field: "needs", kind: "CORRECTED", message: `Not converted into a request: ${needs.map((n) => NEED_LABELS[n]).join(", ")} describe the reported road condition. A coordinator can add needs if help is wanted.` });
      needs = [];
    }
  } else if (category === "ROAD_CONDITION_REPORT") {
    const fallback = needs.length ? needCategory(needs[0]) : "OTHER";
    notes.push({ field: "category", kind: "CORRECTED", message: `Classified as a road report, but the request does not say no help is needed — kept as a request (${CATEGORY_LABELS[fallback]}).` });
    category = fallback;
  }

  const defaultNeed = CATEGORY_DEFAULT_NEED[category];
  if (defaultNeed && !needs.some((n) => needCategory(n) === category)) {
    needs = [...needs, defaultNeed];
    notes.push({ field: "needs", kind: "ADDED", message: `Added ${NEED_LABELS[defaultNeed]} so needs match category “${CATEGORY_LABELS[category]}”.` });
  }

  const summary = proposal.summary || `${CATEGORY_LABELS[category]} request`;
  const rawObj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const aiEvidence = validateNeedEvidence(rawObj.needEvidence, request.text, unique(needs), notes);

  return {
    proposal,
    notes,
    unrecognizedHazards,
    aiEvidence,
    assessment: {
      category,
      summary,
      peopleAffected,
      hazards,
      immediateLifeThreat,
      vulnerabilities,
      needs: unique(needs),
      requestedHelp: informationOnly ? [] : proposal.requestedHelp,
      language,
      ...(informationOnly ? { informationOnly: true } : {}),
    },
  };
}

export function needCategory(n: NeedType): IncidentCategory {
  switch (n) {
    case "TREE_CUTTING":
    case "DEBRIS_REMOVAL":
    case "ACCESS_BLOCKED":
      return "DEBRIS_CLEARANCE";
    case "WATER_MITIGATION":
    case "MUCK_OUT":
    case "MOVE_BELONGINGS":
      return "FLOOD_ASSISTANCE";
    case "ROOF_TARP":
      return "ROOF_DAMAGE";
    case "FOOD":
    case "WATER":
    case "MEDICATION":
      return "SUPPLY_DELIVERY";
    case "POWER_MEDICAL_DEVICE":
    case "DEVICE_CHARGING":
    case "REFRIGERATION":
      return "POWER_NEEDS";
    case "TRANSPORTATION":
      return "TRANSPORTATION";
    case "SHELTER":
      return "SHELTER";
    case "WELLNESS_CHECK":
      return "WELLNESS_CHECK";
    case "GENERATOR_POWER":
      return "POWER_NEEDS";
    case "SHELTER_STAFFING":
      return "SHELTER";
    case "UTILITY_OUTAGE":
      return "POWER_NEEDS";
    case "ROAD_CONDITION":
      return "ROAD_CONDITION_REPORT";
    default:
      return "OTHER";
  }
}
