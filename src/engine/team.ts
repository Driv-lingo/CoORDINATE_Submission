import { ASSET_LABELS, CREDENTIAL_LABELS, ROLE_LABELS, SKILL_LABELS, TRAINING_LABELS } from "@/domain/catalog";
import type { Assignment, CandidateEvaluation, Mission, RequirementSlot, Responder, SlotMatch } from "@/domain/types";
import { credentialState, readinessLevel } from "./readiness";
import { computeCommitments, failedGates, matchIncident, providerCredentialsFor, type MatchContext } from "./matching";

/**
 * Deterministic team formation.
 *
 *  - Person roles are filled first, most-constrained role first (fewest eligible
 *    candidates), so a scarce specialist isn't consumed by an easy role.
 *  - A person fills at most one role on a team.
 *  - Equipment roles prefer responders already on the team, or already
 *    supplying other equipment (fewer vehicles, fewer hand-offs).
 *  - Coordinator overrides are honoured ONLY if the chosen candidate passes
 *    every gate; otherwise the override is rejected with the failing gates.
 */

export interface TeamResult {
  assignments: Assignment[];
  unfilledSlotIds: string[];
  matches: SlotMatch[];
  rejectedOverrides: { slotId: string; responderId: string; reason: string }[];
}

export function assembleTeam(ctx: MatchContext, overrides: Record<string, string> = {}): TeamResult {
  const matches = matchIncident(ctx);
  const bySlot = new Map(matches.map((m) => [m.slotId, m]));
  const slots = ctx.incident.requirements;
  const responders = new Map(ctx.responders.map((r) => [r.id, r]));
  const assignments: Assignment[] = [];
  const unfilled: string[] = [];
  const rejectedOverrides: TeamResult["rejectedOverrides"] = [];
  const usedPeople = new Set<string>();
  const assetUse = new Map<string, number>();
  const commitments = computeCommitments(ctx.missions, ctx.incident.id, ctx.responders);

  const order = (kind: RequirementSlot["kind"]) =>
    slots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === kind)
      .sort((a, b) => (bySlot.get(a.s.id)!.eligibleCount - bySlot.get(b.s.id)!.eligibleCount) || a.i - b.i)
      .map(({ s }) => s);

  const pickOverride = (slot: RequirementSlot): CandidateEvaluation | undefined => {
    const wanted = overrides[slot.id];
    if (!wanted) return undefined;
    const cand = bySlot.get(slot.id)!.candidates.find((c) => c.responderId === wanted);
    if (!cand) {
      rejectedOverrides.push({ slotId: slot.id, responderId: wanted, reason: "Not in the candidate pool for this role" });
      return undefined;
    }
    if (!cand.eligible) {
      rejectedOverrides.push({
        slotId: slot.id,
        responderId: wanted,
        reason: failedGates(cand).map((g) => `${g.gate}: ${g.detail}`).join("; "),
      });
      return undefined;
    }
    if (slot.kind === "PERSON" && usedPeople.has(wanted)) {
      rejectedOverrides.push({ slotId: slot.id, responderId: wanted, reason: "Already assigned to another role on this team" });
      return undefined;
    }
    return cand;
  };

  for (const slot of order("PERSON")) {
    const match = bySlot.get(slot.id)!;
    const chosen = pickOverride(slot) ?? match.candidates.find((c) => c.eligible && !usedPeople.has(c.responderId));
    if (!chosen) {
      unfilled.push(slot.id);
      continue;
    }
    usedPeople.add(chosen.responderId);
    assignments.push(toAssignment(slot, chosen, match, responders.get(chosen.responderId)!, ctx, overrides[slot.id] === chosen.responderId));
  }

  for (const slot of order("ASSET")) {
    const match = bySlot.get(slot.id)!;
    const providers = new Set(assignments.filter((a) => a.assetId).map((a) => a.responderId));
    const freeFor = (c: CandidateEvaluation) => {
      const r = responders.get(c.responderId)!;
      return r.assets.find(
        (a) =>
          a.type === slot.asset &&
          (!slot.accessibleRequired || a.accessible) &&
          a.quantity - (commitments.assetCommitted.get(a.id) ?? 0) - (assetUse.get(a.id) ?? 0) >= slot.quantity,
      );
    };
    const adjusted = (c: CandidateEvaluation) => c.score + (usedPeople.has(c.responderId) ? 10 : 0) + (providers.has(c.responderId) ? 8 : 0);
    const override = pickOverride(slot);
    const chosen =
      override && freeFor(override)
        ? override
        : match.candidates
            .filter((c) => c.eligible && freeFor(c))
            .sort((a, b) => adjusted(b) - adjusted(a) || a.distanceKm - b.distanceKm || a.responderId.localeCompare(b.responderId))[0];
    if (!chosen) {
      unfilled.push(slot.id);
      continue;
    }
    const asset = freeFor(chosen)!;
    assetUse.set(asset.id, (assetUse.get(asset.id) ?? 0) + slot.quantity);
    const assignment = toAssignment(slot, { ...chosen, assetId: asset.id }, match, responders.get(chosen.responderId)!, ctx, overrides[slot.id] === chosen.responderId);
    if (usedPeople.has(chosen.responderId)) assignment.reasons.push("Already on this team — equipment travels with them");
    else if (providers.has(chosen.responderId)) assignment.reasons.push("Already supplying other equipment for this mission — one delivery");
    assignments.push(assignment);
  }

  // Keep display order aligned with the requirement list.
  const idx = new Map(slots.map((s, i) => [s.id, i]));
  assignments.sort((a, b) => idx.get(a.slotId)! - idx.get(b.slotId)!);
  return { assignments, unfilledSlotIds: unfilled, matches, rejectedOverrides };
}

function toAssignment(
  slot: RequirementSlot,
  c: CandidateEvaluation,
  match: SlotMatch,
  r: Responder,
  ctx: MatchContext,
  overridden: boolean,
): Assignment {
  const reasons: string[] = [];
  const now = ctx.now;

  if (slot.kind === "PERSON") {
    for (const cred of providerCredentialsFor(slot, ctx.incident)) {
      const st = credentialState(r, cred, now);
      const exp = st.credential?.expiresAt ? `, expires ${st.credential.expiresAt.slice(0, 7)}` : "";
      reasons.push(`Verified ${CREDENTIAL_LABELS[cred]} (${st.credential?.issuer ?? "external"}${exp})`);
    }
    for (const m of slot.training) reasons.push(`Completed CoORDINATE module: ${TRAINING_LABELS[m].title}`);
    if (slot.skill && slot.credentials.length === 0) reasons.push(`${SKILL_LABELS[slot.skill]} — ${ROLE_LABELS[r.role].toLowerCase()}`);
    const rl = readinessLevel(r, now);
    reasons.push(`Readiness level ${rl.level} — ${rl.name}; ${r.stats.missionsCompleted} verified missions`);
  } else {
    const asset = r.assets.find((a) => a.id === c.assetId);
    reasons.push(`Provides ${asset?.label ?? (slot.asset ? ASSET_LABELS[slot.asset] : "equipment")}${slot.quantity > 1 ? ` × ${slot.quantity}` : ""}`);
    const creds = providerCredentialsFor(slot, ctx.incident);
    if (creds.includes("BACKGROUND_CHECK")) reasons.push(r.kind === "ORGANIZATION" ? "Staff background checks attested (vulnerable household)" : "Verified background check (vulnerable household)");
  }

  reasons.push(`${c.distanceKm} km away · ${r.availability.status === "AVAILABLE" ? "available now" : "limited availability"}`);
  const lang = ctx.incident.assessment.language;
  if (lang !== "en" && r.languages.includes(lang)) reasons.push(`Speaks the household's language (${lang})`);
  if (c.offered) reasons.push("Volunteered for this request");

  const eligible = match.candidates.filter((x) => x.eligible);
  const rank = eligible.findIndex((x) => x.responderId === c.responderId) + 1;
  reasons.push(`Match score ${c.score}/100 — ranked #${rank} of ${eligible.length} eligible`);

  const closerRejected = match.candidates
    .filter((x) => !x.eligible && x.distanceKm < c.distanceKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (closerRejected) {
    const why = failedGates(closerRejected).map((g) => g.detail).join("; ");
    reasons.push(`Selected over nearer ${closerRejected.name} (${closerRejected.distanceKm} km) — rejected: ${why}`);
  }
  if (overridden) reasons.push("Chosen by coordinator (passed all gates)");

  return {
    slotId: slot.id,
    responderId: c.responderId,
    assetId: slot.kind === "ASSET" ? c.assetId : undefined,
    quantity: slot.quantity,
    score: c.score,
    distanceKm: c.distanceKm,
    reasons,
    selectedBy: overridden ? "COORDINATOR" : "ENGINE",
  };
}

/** The person who leads the team on the road: first person assignment (not an equipment-only provider). */
export function leadResponder(mission: Pick<Mission, "assignments">, responders: Responder[]): Responder | undefined {
  const byId = new Map(responders.map((r) => [r.id, r]));
  const person = mission.assignments.find((a) => !a.assetId && byId.get(a.responderId)?.kind === "PERSON") ?? mission.assignments.find((a) => !a.assetId) ?? mission.assignments[0];
  return person ? byId.get(person.responderId) : undefined;
}
