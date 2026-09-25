import { describe, expect, it } from "vitest";
import type { Responder } from "@/domain/types";
import { evaluateCandidate, matchIncident } from "@/engine/matching";
import { assembleTeam } from "@/engine/team";
import { intake, NOW, TREE_TEXT, world } from "./helpers";

function setup() {
  const w = world();
  const incident = intake(TREE_TEXT);
  return { w, incident, ctx: { incident, responders: w.responders, missions: w.missions, now: NOW } };
}
const byId = (rs: Responder[], id: string) => rs.find((r) => r.id === id)!;

describe("gated matching", () => {
  it("never lets proximity override a missing credential (nearest volunteer rejected, farther qualified one ranked first)", () => {
    const { incident, ctx } = setup();
    const op = matchIncident(ctx).find((m) => m.slotId === "chainsaw-operator")!;
    const marcus = op.candidates.find((c) => c.responderId === "r-marcus")!;
    const top = op.candidates[0];
    expect(marcus.eligible).toBe(false);
    expect(marcus.score).toBe(0);
    expect(marcus.gates.find((g) => g.gate === "CREDENTIALS")?.detail).toMatch(/pending/);
    expect(top.responderId).toBe("r-jordan");
    expect(top.distanceKm).toBeGreaterThan(marcus.distanceKm);
    expect(incident.requirements.find((s) => s.id === "chainsaw-operator")?.credentials).toContain("CHAINSAW_SAFETY");
  });

  it("rejects expired credentials, unverified identity, off-duty volunteers and out-of-range responders", () => {
    const { w, ctx, incident } = setup();
    const op = incident.requirements.find((s) => s.id === "chainsaw-operator")!;
    const labor = incident.requirements.find((s) => s.id === "labor-1")!;
    expect(evaluateCandidate(op, byId(w.responders, "r-omar"), ctx).gates.find((g) => g.gate === "CREDENTIALS")?.detail).toMatch(/expired/);
    expect(evaluateCandidate(op, byId(w.responders, "r-ethan"), ctx).gates.find((g) => g.gate === "IDENTITY")?.passed).toBe(false);
    expect(evaluateCandidate(labor, byId(w.responders, "r-hannah"), ctx).gates.find((g) => g.gate === "AVAILABILITY")?.passed).toBe(false);
    const far = { ...byId(w.responders, "r-priya"), maxTravelKm: 1 };
    expect(evaluateCandidate(labor, far, ctx).gates.find((g) => g.gate === "RANGE")?.passed).toBe(false);
  });

  it("rejects people already deployed on another active mission", () => {
    const { w, ctx, incident } = setup();
    const labor = incident.requirements.find((s) => s.id === "labor-1")!;
    const lily = evaluateCandidate(labor, byId(w.responders, "r-lily"), ctx);
    expect(lily.eligible).toBe(false);
    expect(lily.gates.find((g) => g.gate === "CAPACITY")?.detail).toMatch(/Deployed on MSN-/);
  });

  it("scores are bounded and only given to eligible candidates", () => {
    const { ctx } = setup();
    for (const m of matchIncident(ctx))
      for (const c of m.candidates) {
        if (!c.eligible) {
          expect(c.scoreBreakdown).toEqual([]);
        } else {
          expect(c.score).toBeGreaterThan(0);
          expect(c.score).toBeLessThanOrEqual(100);
        }
      }
  });
});

describe("team formation", () => {
  it("assembles the reference team: Jordan (saw), Priya (general), Blue Ridge (truck + chainsaw)", () => {
    const { ctx } = setup();
    const team = assembleTeam(ctx);
    const who = Object.fromEntries(team.assignments.map((a) => [a.slotId, a.responderId]));
    expect(who).toEqual({ "chainsaw-operator": "r-jordan", "labor-1": "r-priya", chainsaw: "o-blueridge", haul: "o-blueridge" });
    expect(team.unfilledSlotIds).toEqual([]);
    const jordan = team.assignments.find((a) => a.slotId === "chainsaw-operator")!;
    expect(jordan.reasons.some((r) => r.includes("Selected over nearer Marcus Hale"))).toBe(true);
  });

  it("never assigns one person to two roles", () => {
    const { ctx } = setup();
    const people = assembleTeam(ctx).assignments.filter((a) => !a.assetId).map((a) => a.responderId);
    expect(new Set(people).size).toBe(people.length);
  });

  it("rejects a coordinator override that fails a gate, but honours an eligible one", () => {
    const { ctx } = setup();
    const bad = assembleTeam(ctx, { "chainsaw-operator": "r-marcus" });
    expect(bad.rejectedOverrides[0]?.reason).toMatch(/CREDENTIALS/);
    expect(bad.assignments.find((a) => a.slotId === "chainsaw-operator")?.responderId).toBe("r-jordan");
    const good = assembleTeam(ctx, { "chainsaw-operator": "r-bobby" });
    const bobby = good.assignments.find((a) => a.slotId === "chainsaw-operator")!;
    expect(bobby.responderId).toBe("r-bobby");
    expect(bobby.selectedBy).toBe("COORDINATOR");
  });

  it("leaves a role unfilled rather than sending an unqualified person (roof needs two certified roofers)", () => {
    const w = world();
    const roof = w.incidents.find((i) => i.id === "inc-roof")!;
    const team = assembleTeam({ incident: roof, responders: w.responders, missions: w.missions, now: NOW });
    expect(team.unfilledSlotIds).toContain("roof-2");
  });
});
