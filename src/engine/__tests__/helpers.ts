import { interpretLocally } from "@/ai/localInterpreter";
import { buildSeedWorld } from "@/data/seed";
import type { IncidentProposal, IntakeRequest } from "@/domain/types";
import { requestCommunityHelp } from "@/engine/lifecycle";
import { buildIncident } from "@/engine/pipeline";

export const NOW = new Date("2026-09-22T18:00:00Z");
export const CAVE_SPRING = { lat: 37.2275, lng: -80.001 };

export function request(text: string, extra: Partial<IntakeRequest> = {}): IntakeRequest {
  return { text, locationText: "Cave Spring", accessibilityNeeds: [], immediateDanger: false, ...extra };
}

/** Run the full intake pipeline; `raw` lets a test impersonate the AI's output. */
export function intake(text: string, opts: { extra?: Partial<IntakeRequest>; raw?: unknown; location?: { lat: number; lng: number }; requestHelp?: boolean } = {}) {
  const req = request(text, opts.extra);
  const proposal: IncidentProposal = interpretLocally(req);
  const built = buildIncident({
    id: "inc-test",
    number: "INC-9999",
    workspaceId: "ws-test",
    source: "RESIDENT_APP",
    request: req,
    location: opts.location ?? CAVE_SPRING,
    locality: "Roanoke County",
    locationLabel: "Cave Spring",
    interpretation: { provider: "local-rules", latencyMs: 1, proposal },
    raw: opts.raw ?? proposal,
    now: NOW,
  });
  // Most engine tests exercise the orchestration half: the resident asks for help with every stated community need.
  if (opts.requestHelp === false) return built;
  const offered = built.needs.filter((n) => n.status === "HELP_AVAILABLE" && n.origin === "STATED").map((n) => n.id);
  return offered.length && built.status === "GUIDED" ? requestCommunityHelp(built, offered, "Resident", "resident", NOW) : built;
}

export function world() {
  return buildSeedWorld("ws-test", NOW);
}

export const TREE_TEXT = "A tree fell across my driveway. Nobody is injured but we cannot leave the property and my mother uses a wheelchair.";
