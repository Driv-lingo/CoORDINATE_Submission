import { describe, expect, it } from "vitest";
import { checkDispatch } from "@/engine/dispatch";
import { completeMission, dispatch, LifecycleError, proposeTeam, setNeeds, startMission, verifyMission } from "@/engine/lifecycle";
import { slotIsOptional } from "@/domain/slots";
import { intake, NOW, TREE_TEXT, world } from "./helpers";

function proposed() {
  const w = world();
  const incident = intake(TREE_TEXT);
  const p = proposeTeam({ incident, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
  return { w, ...p };
}

describe("mission lifecycle", () => {
  it("runs propose → dispatch → start → complete → verify", () => {
    const { w, incident, mission } = proposed();
    expect(mission.code).toBe("MSN-021");
    expect(mission.title).toBe("Blocked Accessible Residence");
    const d = dispatch({ incident, mission, responders: w.responders, missions: w.missions, actorName: "Ellis", now: NOW });
    expect(d.mission.status).toBe("DISPATCHED");
    expect(d.incident.status).toBe("ACTIVE");
    const s = startMission(d.incident, d.mission, "Jordan", NOW);
    const c = completeMission(s.incident, s.mission, "Jordan", "Driveway clear", new Date(NOW.getTime() + 2 * 36e5));
    const v = verifyMission({ incident: c.incident, mission: c.mission, responders: w.responders, by: "Denise", byRole: "resident", note: "", now: NOW });
    expect(v.incident.status).toBe("RESOLVED");
    expect(v.mission.status).toBe("VERIFIED");
    const jordan = v.responders.find((r) => r.id === "r-jordan")!;
    expect(jordan.stats.missionsCompleted).toBe(8);
    expect(jordan.stats.hoursContributed).toBeGreaterThan(46);
  });

  it("refuses to verify before the team reports completion", () => {
    const { w, incident, mission } = proposed();
    const d = dispatch({ incident, mission, responders: w.responders, missions: w.missions, actorName: "Ellis", now: NOW });
    expect(() => verifyMission({ incident: d.incident, mission: d.mission, responders: w.responders, by: "x", byRole: "coordinator", note: "", now: NOW })).toThrow(LifecycleError);
  });

  it("will not form a civilian team for an escalated incident", () => {
    const w = world();
    const inc = intake("The wires are down and sparking across the road.");
    expect(() => proposeTeam({ incident: inc, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW })).toThrow(/escalated/);
  });

  it("draws down consumable supplies on verification", () => {
    const w = world();
    const pantryBefore = w.responders.find((r) => r.id === "o-pantry")!.assets.find((a) => a.type === "WATER_SUPPLY")!.quantity;
    // Homebound (rule N-05): a delivery is a community mission; otherwise it is a referral to a distribution point.
    const inc = intake("We are out of drinking water and food for our two kids and our road is washed out.", { extra: { peopleAffected: 4 } });
    const p = proposeTeam({ incident: inc, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
    const d = dispatch({ incident: p.incident, mission: p.mission, responders: w.responders, missions: w.missions, actorName: "E", now: NOW });
    const c = completeMission(d.incident, d.mission, "x", "done", NOW);
    const v = verifyMission({ incident: c.incident, mission: c.mission, responders: w.responders, by: "E", byRole: "coordinator", note: "", now: NOW });
    const water = v.responders.find((r) => r.id === "o-pantry")?.assets.find((a) => a.type === "WATER_SUPPLY");
    expect(water?.quantity).toBe(pantryBefore - 12);
  });
});

describe("dispatch gate", () => {
  it("lets a coordinator dispatch without optional equipment, but only with explicit acknowledgement", () => {
    const { w, incident, mission } = proposed();
    expect(slotIsOptional(incident.requirements.find((s) => s.id === "haul")!)).toBe(true);
    const short = { ...mission, assignments: mission.assignments.filter((a) => a.slotId !== "haul") };
    const blocked = checkDispatch({ incident, mission: short, responders: w.responders, missions: w.missions, now: NOW });
    const slots = blocked.checks.find((c) => c.id === "D-SLOTS")!;
    expect(blocked.ok).toBe(false);
    expect(slots.acknowledgeable).toBe(true);
    expect(slots.detail).toMatch(/Pickup truck/);
    expect(() => dispatch({ incident, mission: short, responders: w.responders, missions: w.missions, actorName: "E", now: NOW })).toThrow(/Dispatch blocked/);

    const d = dispatch({ incident, mission: short, responders: w.responders, missions: w.missions, actorName: "E", allowPartial: true, note: "Resident will drag branches aside", now: NOW });
    expect(d.mission.status).toBe("DISPATCHED");
    expect(d.mission.dispatchedWithout).toMatchObject({ slotIds: ["haul"], labels: ["Pickup truck"], note: "Resident will drag branches aside", by: "E" });
    expect(d.incident.timeline.at(-1)?.message).toMatch(/without: Pickup truck/);
  });

  it("decides optionality from the slot itself, so incidents stored before a rule change follow the current rule", () => {
    // A wet/dry vacuum slot saved without any optional flag (as on incidents created earlier).
    expect(slotIsOptional({ kind: "ASSET", asset: "WET_VAC" })).toBe(true);
    expect(slotIsOptional({ kind: "ASSET", asset: "WATER_PUMP" })).toBe(true);
    // Safety, accessibility and the supplies being delivered are never optional.
    for (const asset of ["HAND_TOOLS", "ACCESSIBLE_VAN", "REFRIGERATION", "PORTABLE_BATTERY", "FOOD_SUPPLY"] as const) expect(slotIsOptional({ kind: "ASSET", asset })).toBe(false);
    expect(slotIsOptional({ kind: "ASSET", asset: "PASSENGER_VEHICLE", accessibleRequired: true })).toBe(false);
    expect(slotIsOptional({ kind: "PERSON" })).toBe(false);
  });

  it("never lets a coordinator skip an essential role, even with acknowledgement", () => {
    const { w, incident, mission } = proposed();
    const noSaw = { ...mission, assignments: mission.assignments.filter((a) => a.slotId !== "chainsaw-operator") };
    expect(slotIsOptional(incident.requirements.find((s) => s.id === "chainsaw-operator")!)).toBe(false);
    const res = checkDispatch({ incident, mission: noSaw, responders: w.responders, missions: w.missions, now: NOW, allowPartial: true });
    const slots = res.checks.find((c) => c.id === "D-SLOTS")!;
    expect(slots.passed).toBe(false);
    expect(slots.acknowledgeable).toBeFalsy();
    expect(() => dispatch({ incident, mission: noSaw, responders: w.responders, missions: w.missions, actorName: "E", allowPartial: true, now: NOW })).toThrow(/Dispatch blocked/);
  });

  it("passes for a valid proposed team", () => {
    const { w, incident, mission } = proposed();
    expect(checkDispatch({ incident, mission, responders: w.responders, missions: w.missions, now: NOW }).ok).toBe(true);
  });

  it("blocks dispatch when a credential expires after the team was proposed", () => {
    const { w, incident, mission } = proposed();
    const responders = w.responders.map((r) =>
      r.id === "r-jordan" ? { ...r, credentials: r.credentials.map((c) => (c.type === "CHAINSAW_SAFETY" ? { ...c, expiresAt: "2026-01-01T00:00:00Z" } : c)) } : r,
    );
    const res = checkDispatch({ incident, mission, responders, missions: w.missions, now: NOW });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.id === "D-GATES")?.detail).toMatch(/Jordan Reyes/);
    expect(() => dispatch({ incident, mission, responders, missions: w.missions, actorName: "E", now: NOW })).toThrow(/Dispatch blocked/);
  });

  it("blocks dispatch while a safety advisory is unacknowledged", () => {
    const w = world();
    const inc = intake("Several trees are down across our lane and we can't get out. No power lines are down.");
    const p = proposeTeam({ incident: inc, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
    const res = checkDispatch({ incident: p.incident, mission: p.mission, responders: w.responders, missions: w.missions, now: NOW });
    expect(res.checks.find((c) => c.id === "D-ADVISORY")?.passed).toBe(false);
  });

  it("blocks dispatch if the person was deployed elsewhere in the meantime", () => {
    const { w, incident, mission } = proposed();
    const other = { ...mission, id: "msn-other", incidentId: "inc-other", code: "MSN-099", status: "DISPATCHED" as const };
    const res = checkDispatch({ incident, mission, responders: w.responders, missions: [...w.missions, other], now: NOW });
    expect(res.checks.find((c) => c.id === "D-GATES")?.passed).toBe(false);
  });
});

describe("unclassified requests", () => {
  it("cannot form or dispatch a team until a coordinator classifies the need", () => {
    const w = world();
    const inc = intake("Hello, please could somebody call me back about our situation here.");
    expect(inc.triage.civilianDispatchAllowed).toBe(true);
    expect(inc.requirements).toEqual([]);
    expect(() => proposeTeam({ incident: inc, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW })).toThrow(/No capability requirements/);

    const empty = { id: "m", workspaceId: "ws-test", number: 21, code: "MSN-021", title: "x", incidentId: inc.id, status: "PROPOSED" as const, assignments: [], unfilledSlotIds: [], createdAt: NOW.toISOString() };
    expect(checkDispatch({ incident: inc, mission: empty, responders: w.responders, missions: w.missions, now: NOW }).checks.find((c) => c.id === "D-SLOTS")?.passed).toBe(false);

    const fixed = setNeeds(inc, ["TREE_CUTTING"], "Ellis", NOW);
    expect(fixed.requirements.map((r) => r.id)).toEqual(expect.arrayContaining(["chainsaw-operator", "chainsaw"]));
    expect(fixed.triage.level).toBe("TRAINED_VOLUNTEER_ELIGIBLE");
    expect(fixed.timeline.at(-1)?.message).toMatch(/adjusted needs \+Tree cutting/);
  });

  it("adjusting needs never removes a hazard", () => {
    const inc = intake("The wires are down and sparking across the road.");
    const edited = setNeeds(inc, ["DEBRIS_REMOVAL"], "Ellis", NOW);
    expect(edited.triage.civilianDispatchAllowed).toBe(false);
    expect(edited.requirements).toEqual([]);
  });
});
