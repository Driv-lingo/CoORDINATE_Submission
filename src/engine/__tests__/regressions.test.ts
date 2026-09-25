import { describe, expect, it } from "vitest";
import { checkDispatch } from "@/engine/dispatch";
import { dispatch, proposeTeam, requestCommunityHelp, setNeeds } from "@/engine/lifecycle";
import { computeCommitments } from "@/engine/matching";
import { intake, NOW, world } from "./helpers";

/** Regression tests for issues found in the independent safety review. */
describe("safety review regressions", () => {
  it.each([
    "We have no power and dad is unconscious, our phones are dead and we need water to drink.",
    "Our phone isn't working and grandma is having chest pains",
    "The ice is gone, nobody can get insulin, and she is not breathing well",
  ])("an unrelated negation never hides a medical emergency: %s", (text) => {
    const inc = intake(text);
    expect(inc.assessment.hazards).toContain("MEDICAL_EMERGENCY");
    expect(inc.triage.level).toBe("LIFE_SAFETY_EMERGENCY");
  });

  it("a negation in an earlier clause does not hide a later hazard", () => {
    const inc = intake("We can't get out, the power lines are down across the road.");
    expect(inc.assessment.hazards).toContain("DOWNED_POWER_LINE");
    expect(inc.triage.civilianDispatchAllowed).toBe(false);
  });

  it("a null or malformed field in the AI output never discards the AI's hazards", () => {
    const inc = intake("Something smells really strange in the kitchen", {
      raw: { hazards: ["GAS_LEAK"], immediateLifeThreat: true, peopleAffected: null, requestedHelp: "help" },
    });
    expect(inc.assessment.hazards).toContain("GAS_LEAK");
    expect(inc.triage.civilianDispatchAllowed).toBe(false);
  });

  it("an unrecognized AI hazard raises an advisory instead of vanishing", () => {
    const inc = intake("Tree down in the yard, something strange going on", { raw: { hazards: ["ELECTRICAL_ARC"], needs: ["TREE_CUTTING"] } });
    expect(inc.advisories.map((a) => a.ruleId)).toContain("R-A03");
  });

  it("the AI cannot lower the tier by omitting a credentialed need", () => {
    const inc = intake("A tree fell across my driveway and we cannot leave.", { raw: { category: "DEBRIS_CLEARANCE", needs: ["DEBRIS_REMOVAL", "ACCESS_BLOCKED"] } });
    expect(inc.assessment.needs).toContain("TREE_CUTTING");
    expect(inc.triage.level).toBe("TRAINED_VOLUNTEER_ELIGIBLE");
    expect(inc.requirements.map((r) => r.id)).toContain("chainsaw-operator");
  });

  it("a person delivering equipment on one mission cannot be booked on another", () => {
    const w = world();
    const first = intake("We are out of drinking water and food for our kids and we can't drive anywhere.", { extra: { peopleAffected: 2 } });
    const p1 = proposeTeam({ incident: first, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
    const d1 = dispatch({ incident: p1.incident, mission: p1.mission, responders: w.responders, missions: w.missions, actorName: "E", now: NOW });
    const personProviders = d1.mission.assignments.filter((a) => a.assetId && w.responders.find((r) => r.id === a.responderId)?.kind === "PERSON");
    const missions = [...w.missions, d1.mission];
    const c = computeCommitments(missions, undefined, w.responders);
    for (const a of personProviders) expect(c.personBusy.has(a.responderId)).toBe(true);
    // A mission whose asset is owned by a person marks that person deployed.
    const synthetic = { ...d1.mission, id: "m-x", incidentId: "inc-x", code: "MSN-090", assignments: [{ slotId: "haul", responderId: "r-tom", assetId: "r-tom-pickup-truck", quantity: 1, score: 50, distanceKm: 1, reasons: [], selectedBy: "ENGINE" as const }] };
    expect(computeCommitments([synthetic], undefined, w.responders).personBusy.get("r-tom")).toBe("MSN-090");
  });

  it("adding power for a medical device re-raises the R-A02 advisory and blocks dispatch until acknowledged", () => {
    const w = world();
    const inc = intake("Our phones are dead and we need to charge them.");
    const corrected = setNeeds(inc, [...inc.assessment.needs, "POWER_MEDICAL_DEVICE"], "Ellis", NOW);
    expect(corrected.advisories.map((a) => a.ruleId)).toContain("R-A02");
    // Charging alone is a referral (N-05); the device power is a resource transfer the coordinator requests for them.
    const edited = requestCommunityHelp(corrected, corrected.needs.filter((n) => n.type === "POWER_MEDICAL_DEVICE").map((n) => n.id), "Ellis", "coordinator", NOW);
    const p = proposeTeam({ incident: edited, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
    expect(checkDispatch({ incident: p.incident, mission: p.mission, responders: w.responders, missions: w.missions, now: NOW }).checks.find((x) => x.id === "D-ADVISORY")?.passed).toBe(false);
  });
});
