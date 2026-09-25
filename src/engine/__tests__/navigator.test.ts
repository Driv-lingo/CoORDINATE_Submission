import { describe, expect, it } from "vitest";
import { draftHandoffSummary, violatesWordingPolicy } from "@/ai";
import { ASSISTANCE_DIRECTORY } from "@/data/assistanceDirectory";
import type { Need } from "@/domain/types";
import { clearHazard, proposeTeam, requestCommunityHelp, setNeeds } from "@/engine/lifecycle";
import { decomposeNeeds, EXERCISE_CONTEXT, LIVE_CONTEXT, missionNeedTypes, recommendServices, servicePending } from "@/engine/navigator";
import { validateProposal } from "@/engine/validate";
import { intake, NOW, request, world } from "./helpers";

const byType = (needs: Need[], t: Need["type"]) => needs.find((n) => n.type === t);

describe("Need → resolution path (navigator)", () => {
  it("decomposes the flooded-basement request into needs, a household consideration and suggestions", () => {
    const i = intake("My basement is flooding and my father can't walk up the stairs.", { requestHelp: false });
    expect(i.status).toBe("GUIDED");
    expect(i.assessment.vulnerabilities).toContain("MOBILITY_LIMITED");
    expect(byType(i.needs, "WATER_MITIGATION")).toMatchObject({ path: "COMMUNITY_MISSION", status: "HELP_AVAILABLE", origin: "STATED" });
    // N-14: related needs are offered, never requested or escalated on the resident's behalf.
    expect(byType(i.needs, "TRANSPORTATION")).toMatchObject({ origin: "SUGGESTED", status: "HELP_AVAILABLE" });
    expect(byType(i.needs, "SHELTER")).toMatchObject({ origin: "SUGGESTED", path: "SERVICE_REFERRAL" });
    expect(i.handoffs).toEqual([]);
    expect(i.requirements.map((r) => r.id)).toEqual(["flood-1", "pump", "vac"]);
  });

  it("gives each need of a multi-need request its own path", () => {
    const i = intake(
      "A tree fell across our driveway and the power is out. Nobody is hurt, but we can't get out and my mother uses a wheelchair. We don't know where we can stay tonight or whether FEMA can help with the damage.",
      { requestHelp: false },
    );
    expect(byType(i.needs, "TREE_CUTTING")?.path).toBe("COMMUNITY_MISSION");
    expect(byType(i.needs, "UTILITY_OUTAGE")).toMatchObject({ path: "SERVICE_REFERRAL", serviceIds: ["svc-apco-outage"] });
    // N-07: shelter with access needs goes to a person.
    expect(byType(i.needs, "SHELTER")).toMatchObject({ path: "HUMAN_ESCALATION", status: "ESCALATION_RECOMMENDED", escalateTo: ["SHELTER_COORDINATOR"] });
    // N-09: no federal declaration in the exercise → information, with the condition stated.
    expect(byType(i.needs, "DISASTER_ASSISTANCE")?.path).toBe("INFORMATION");
    expect(i.handoffs.map((h) => h.target)).toEqual(["SHELTER_COORDINATOR"]);
    expect(i.handoffs[0]).toMatchObject({ destination: "SHELTER_COORDINATOR", ruleId: "N-07", status: "RECOMMENDED" });
    expect(i.handoffs[0].summary?.text).toMatch(/no agency or person has been contacted/);
  });

  it("a sparking power line is professional response only — no community mission", () => {
    const i = intake("There is a sparking power line.", { requestHelp: false });
    expect(i.status).toBe("ESCALATED");
    expect(i.needs.map((n) => n.path)).toEqual(["PROFESSIONAL_RESPONSE"]);
    expect(i.requirements).toEqual([]);
    expect(i.handoffs.map((h) => h.target).sort()).toEqual(["ELECTRIC_UTILITY", "FIRE_RESCUE_911"]);
    // WHO: the suggested contact fits the destination (never 911 as the utility's contact).
    expect(i.handoffs.find((h) => h.target === "ELECTRIC_UTILITY")?.serviceId).toBe("svc-apco-outage");
    expect(i.handoffs.find((h) => h.target === "FIRE_RESCUE_911")?.serviceId).toBe("svc-911");
    const w = world();
    expect(() => proposeTeam({ incident: i, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW })).toThrow();
  });

  it("blocks community needs at a hazard site (N-03) until the authority clears it", () => {
    const i = intake("A tree came down on the power lines in front of our house and the wires are sparking. Nobody is hurt.", { requestHelp: false });
    expect(byType(i.needs, "TREE_CUTTING")).toMatchObject({ status: "BLOCKED_BY_HAZARD", ruleId: "N-03" });
    expect(() => requestCommunityHelp(i, [byType(i.needs, "TREE_CUTTING")!.id], "R", "resident", NOW)).toThrow();
    const cleared = clearHazard(i, "DOWNED_POWER_LINE", "Electric utility crew", "de-energized", "Ellis", NOW);
    expect(byType(cleared.needs, "TREE_CUTTING")?.status).toBe("HELP_AVAILABLE");
    expect(byType(cleared.needs, "HAZARD_RESPONSE")?.status).toBe("RESOLVED");
    expect(cleared.status).toBe("GUIDED");
  });

  it("food: a referral for people who can travel, a delivery mission when homebound (N-05)", () => {
    expect(byType(intake("We need food for the kids.", { requestHelp: false }).needs, "FOOD")?.path).toBe("SERVICE_REFERRAL");
    expect(byType(intake("We need food and our road is washed out.", { requestHelp: false }).needs, "FOOD")?.path).toBe("COMMUNITY_MISSION");
    expect(byType(intake("My 81-year-old neighbor needs food.", { requestHelp: false }).needs, "FOOD")?.path).toBe("COMMUNITY_MISSION");
  });

  it("routes recovery and distress to people and counselors, and crisis words to 988 first", () => {
    const r = intake("We lost everything and I don't know where to start. I'm so overwhelmed.", { requestHelp: false });
    expect(byType(r.needs, "RECOVERY_CASEWORK")).toMatchObject({ path: "HUMAN_ESCALATION", escalateTo: ["HUMAN_CASEWORKER"] });
    expect(byType(r.needs, "EMOTIONAL_SUPPORT")?.serviceIds[0]).toBe("svc-ddh");
    const c = intake("The flood took everything and I want to end my life.", { requestHelp: false });
    const e = byType(c.needs, "EMOTIONAL_SUPPORT")!;
    expect(e).toMatchObject({ urgency: "IMMEDIATE", path: "HUMAN_ESCALATION" });
    expect(e.serviceIds[0]).toBe("svc-988");
    expect(c.requirements).toEqual([]);
  });

  it("never leaves a person without a path (N-13)", () => {
    const i = intake("hello, is anyone there?", { requestHelp: false });
    expect(i.needs).toHaveLength(1);
    expect(i.needs[0]).toMatchObject({ type: "GENERAL_GUIDANCE", path: "HUMAN_ESCALATION" });
  });
});

describe("the resident decides (N-15)", () => {
  it("nothing is staffed until help is requested, and only the requested needs become requirements", () => {
    const w = world();
    const i = intake("My basement is flooding and my father can't walk up the stairs.", { requestHelp: false });
    expect(() => proposeTeam({ incident: i, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW })).toThrow(/requested|asked/);
    const ride = byType(i.needs, "TRANSPORTATION")!;
    const r = requestCommunityHelp(i, [ride.id], "Denise", "resident", NOW);
    expect(r.status).toBe("OPEN");
    expect(missionNeedTypes(r.needs)).toEqual(["TRANSPORTATION"]);
    expect(r.requirements.map((s) => s.label)).toEqual(["Accessible-transport driver", "Wheelchair-accessible van"]);
    expect(byType(r.needs, "WATER_MITIGATION")?.status).toBe("NOT_REQUESTED");
    const p = proposeTeam({ incident: r, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
    expect(byType(p.incident.needs, "TRANSPORTATION")).toMatchObject({ status: "MISSION_ACTIVE", missionId: p.mission.id });
  });

  it("refuses to request referrals as missions", () => {
    const i = intake("The power is out.", { requestHelp: false });
    expect(() => requestCommunityHelp(i, [i.needs[0].id], "D", "resident", NOW)).toThrow(/trusted service/);
  });

  it("a coordinator's correction on a requested incident is part of the request", () => {
    const i = intake("A tree fell across my driveway and we cannot get out.");
    const edited = setNeeds(i, [...i.assessment.needs, "WELLNESS_CHECK"], "Ellis", NOW);
    expect(byType(edited.needs, "WELLNESS_CHECK")?.status).toBe("HELP_REQUESTED");
    expect(edited.requirements.some((s) => s.id === "visit-1")).toBe(true);
  });
});

describe("Trusted Assistance Directory", () => {
  it("every entry carries its provenance, and exercise entries are marked", () => {
    for (const s of ASSISTANCE_DIRECTORY) {
      expect(s.authoritativeSource).toBeTruthy();
      expect(s.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.contactMethods.length).toBeGreaterThan(0);
      if (s.simulated) expect(s.name).toMatch(/exercise/i);
      else expect(s.authoritativeSource).toMatch(/^https:\/\//);
    }
  });

  it("live workspaces never see exercise activations; geography limits local services", () => {
    const f = { vulnerabilities: [], context: LIVE_CONTEXT };
    const live = recommendServices("SHELTER", { lat: 37.27, lng: -79.94 }, f);
    expect(live.some((id) => id.startsWith("ex-"))).toBe(false);
    expect(recommendServices("SHELTER", { lat: 37.27, lng: -79.94 }, { ...f, context: EXERCISE_CONTEXT })[0]).toBe("ex-shelter-grace");
    // Richmond is outside the Roanoke Valley utility and outage entry.
    expect(recommendServices("UTILITY_OUTAGE", { lat: 37.54, lng: -77.43 }, f)).toEqual([]);
  });

  it("states eligibility honestly: pending in the exercise, check-for-yourself when unknown", () => {
    const fema = ASSISTANCE_DIRECTORY.find((s) => s.id === "svc-fema-ia")!;
    expect(servicePending(fema, EXERCISE_CONTEXT)[0]).toMatch(/Not in effect yet/);
    expect(servicePending(fema, LIVE_CONTEXT)[0]).toMatch(/Check whether it applies/);
    const declared = { ...EXERCISE_CONTEXT, declarations: { federal: true, stateActivation: true } };
    expect(servicePending(fema, declared)).toEqual([]);
    const i = intake("Can FEMA help pay for the damage?", { requestHelp: false });
    const n = decomposeNeeds({ incidentId: "x", assessment: i.assessment, triage: i.triage, request: i.request, location: i.location, clearances: [], context: declared, now: NOW });
    expect(byType(n, "DISASTER_ASSISTANCE")?.path).toBe("SERVICE_REFERRAL");
  });
});

describe("Foundry need evidence and handoff summaries", () => {
  it("keeps only quotes that are really in the resident's words, and drops navigator-only needs", () => {
    const req = request("Our basement is flooding and the power is out.");
    const raw = {
      category: "FLOOD_ASSISTANCE",
      needs: ["WATER_MITIGATION", "UTILITY_OUTAGE", "EMERGENCY_RESPONSE"],
      needEvidence: [
        { need: "WATER_MITIGATION", quote: "basement is flooding" },
        { need: "UTILITY_OUTAGE", quote: "the electricity has been off for days" },
      ],
    };
    const v = validateProposal(raw, req, []);
    expect(v.aiEvidence).toEqual({ WATER_MITIGATION: "basement is flooding" });
    expect(v.assessment.needs).not.toContain("EMERGENCY_RESPONSE");
    expect(v.notes.some((x) => x.field === "needEvidence" && x.kind === "REJECTED")).toBe(true);
  });

  it("uses the template when Foundry is not configured, and the template never claims contact", async () => {
    const i = intake("There is a sparking power line.", { requestHelp: false });
    const s = await draftHandoffSummary(i, i.handoffs[0], NOW);
    expect(s.provider).toBe("local-rules");
    expect(violatesWordingPolicy(s.text)).toBe(false);
    expect(s.text).toMatch(/Why: .*N-02/);
  });
});
