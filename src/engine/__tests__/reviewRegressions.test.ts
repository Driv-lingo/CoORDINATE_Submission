import { describe, expect, it } from "vitest";
import type { Geometry, OperationalEvent } from "@/domain/ops";
import { correlate, isStale, restrictionsFrom } from "@/engine/correlate";
import { circlePolygon } from "@/engine/geometry";
import { applyAssessment, attachRoute, dispatch, LifecycleError, proposeTeam, resumeMission, startMission } from "@/engine/lifecycle";
import { assessMission } from "@/engine/reassess";
import { planDeterministicRoute, routeOnGraph } from "@/engine/routing";
import { intake, NOW, TREE_TEXT, world } from "./helpers";

/** Regressions for the independent review of the situational-awareness layer. */

const JORDAN = { lat: 37.287, lng: -80.045, label: "Jordan (Salem)" };
const CAVE_SPRING = { lat: 37.2275, lng: -80.001, label: "Cave Spring" };
const RTE419_CRASH: [number, number] = [-80.0175, 37.2545];
const at = (min: number) => new Date(NOW.getTime() + min * 6e4);

let seq = 0;
function ev(p: Partial<OperationalEvent> & Pick<OperationalEvent, "type" | "sourceType" | "authorityLevel" | "geometry">): OperationalEvent {
  seq++;
  return {
    id: `rv-${seq}`,
    workspaceId: "ws-test",
    mode: "SCENARIO",
    simulated: true,
    category: "TRAFFIC",
    sourceId: `${p.sourceType}-${seq}`,
    sourceName: p.sourceType,
    verificationStatus: "UNVERIFIED",
    title: `${p.type} test`,
    fetchedAt: NOW.toISOString(),
    eventTime: NOW.toISOString(),
    effects: [],
    ...p,
  };
}

const tornado = (geometry: Geometry, expiresMin = 30) =>
  ev({ type: "TORNADO_WARNING", category: "ALERT", sourceType: "NWS", authorityLevel: "AUTHORITATIVE_ALERT", geometry, expiresAt: at(expiresMin).toISOString(), effects: [{ kind: "HOLD_ALL_ACTIVITY" }] });
const closure = (coords: [number, number] = RTE419_CRASH) =>
  ev({ type: "ROAD_CLOSURE", sourceType: "VIRGINIA_511", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "Point", coordinates: coords }, effects: [{ kind: "BLOCKS_ROAD" }] });

function dispatched() {
  const w = world();
  const inc = intake(TREE_TEXT);
  const p = proposeTeam({ incident: inc, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
  const d = dispatch({ incident: p.incident, mission: p.mission, responders: w.responders, missions: w.missions, actorName: "E", now: NOW });
  return attachRoute(d.incident, d.mission, routeOnGraph({ origin: JORDAN, destination: CAVE_SPRING, restrictions: [], version: 1, now: NOW })!, NOW);
}

function reassess(state: ReturnType<typeof dispatched>, events: OperationalEvent[], now: Date, plan = true) {
  const clusters = correlate(events, now);
  const { restrictions } = restrictionsFrom(clusters);
  const a = assessMission({ mission: state.mission, incident: state.incident, clusters, restrictions });
  const newRoute = a.needsRoute && plan ? planDeterministicRoute({ origin: JORDAN, destination: CAVE_SPRING, restrictions, version: 9, now }) : a.needsRoute ? null : undefined;
  return applyAssessment({ incident: state.incident, mission: state.mission, assessment: a, newRoute, now });
}

describe("H1 — a cleared hold is reinstated when the condition returns, and upgraded on escalation", () => {
  it("re-holds instead of allowing resume", () => {
    const s0 = dispatched();
    const area = circlePolygon([-80.0, 37.23], 3000);
    const held = reassess(s0, [tornado(area, 20)], NOW);
    expect(held.mission.hold?.ruleId).toBe("W-01");
    const cleared = reassess(held, [], at(25));
    expect(cleared.mission.hold?.conditionCleared).toBe(true);
    // A new warning arrives before anyone resumes.
    const again = reassess(cleared, [tornado(area, 60)], at(26));
    expect(again.changed).toBe(true);
    expect(again.mission.hold?.conditionCleared).toBeFalsy();
    expect(() => resumeMission(again.incident, again.mission, "Ellis", at(27))).toThrow(LifecycleError);
  });

  it("upgrades a weather hold to a suspension when an evacuation covers the site, and recommends escalation", () => {
    const s0 = dispatched();
    const storm = ev({ type: "SEVERE_THUNDERSTORM_WARNING", category: "ALERT", sourceType: "NWS", authorityLevel: "AUTHORITATIVE_ALERT", geometry: circlePolygon([-80.0, 37.23], 3000), effects: [{ kind: "HOLD_OUTDOOR_WORK" }] });
    const held = reassess(s0, [storm], NOW);
    expect(held.mission.hold?.ruleId).toBe("W-02");
    const evac = ev({ type: "EVACUATION", category: "ALERT", sourceType: "IPAWS", authorityLevel: "AUTHORITATIVE_ALERT", geometry: circlePolygon([-80.001, 37.2275], 800), effects: [{ kind: "NO_CIVILIAN_ENTRY" }] });
    const up = reassess(held, [storm, evac], at(1));
    expect(up.mission.hold?.ruleId).toBe("S-01");
    expect(up.mission.hold?.instruction).toMatch(/Leave the area/);
    expect(up.incident.handoffs.map((h) => h.status)).toContain("RECOMMENDED");
  });
});

describe("H2 — a no-route hold clears only when a route exists", () => {
  it("stays held while the only roads are blocked, and clears with a new route that must be acknowledged", () => {
    const s0 = dispatched();
    const block = closure();
    const held = reassess(s0, [block], NOW, false);
    expect(held.mission.hold?.ruleId).toBe("R-02");
    // Next pass, still no route: not cleared.
    const still = reassess(held, [block], at(1), false);
    expect(still.mission.hold?.conditionCleared).toBeFalsy();
    // A route becomes available: cleared, route attached, resume requires acknowledgement.
    const cleared = reassess(still, [block], at(2), true);
    expect(cleared.mission.hold?.conditionCleared).toBe(true);
    expect(cleared.mission.route!.etaMinutes).toBeGreaterThan(s0.mission.route!.etaMinutes);
    expect(resumeMission(cleared.incident, cleared.mission, "Ellis", at(3)).mission.status).toBe("REROUTING");
  });
});

describe("H3 — every member's geometry counts", () => {
  it("holds a site inside the second of two merged warning polygons", () => {
    // On scene, so only the site test applies (a moving team's route also crosses polygon A).
    const d = dispatched();
    const s0 = startMission(d.incident, d.mission, "Jordan", NOW);
    const a = tornado(circlePolygon([-80.03, 37.26], 2500));
    // B's centroid lies inside A, but B also covers the Cave Spring site; A does not.
    const b = tornado(circlePolygon([-80.012, 37.245], 2600));
    const clusters = correlate([a, b], NOW);
    expect(clusters).toHaveLength(1);
    const r = assessMission({ mission: s0.mission, incident: s0.incident, clusters, restrictions: [] });
    expect(r.hits.map((h) => h.ruleId)).toContain("W-01");
  });

  it("places a closure on the line that reported it, not on a nearby point member", () => {
    // Ids as the live feeds produce them: "azm-…" sorts before "va511-…".
    const line = ev({ id: "va511-wz-1", type: "ROAD_CLOSURE", sourceType: "VIRGINIA_511", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "LineString", coordinates: [RTE419_CRASH, [-80.012, 37.247]] }, effects: [{ kind: "BLOCKS_ROAD" }] });
    const point = ev({ id: "azm-123", type: "CONGESTION", sourceType: "AZURE_MAPS_TRAFFIC", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "Point", coordinates: [RTE419_CRASH[0] - 0.001, RTE419_CRASH[1]] }, effects: [{ kind: "SLOWS_ROAD" }] });
    const { restrictions } = restrictionsFrom(correlate([point, line], NOW));
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0].geometry.type).toBe("LineString");
  });
});

describe("H4 — feed conditions age from the last poll, observations from when they were made", () => {
  it("keeps a day-old closure current while the feed still lists it", () => {
    const old = { ...closure(), eventTime: at(-24 * 60).toISOString(), fetchedAt: NOW.toISOString() };
    expect(isStale(old, NOW)).toBe(false);
    expect(isStale({ ...old, fetchedAt: at(-13 * 60).toISOString() }, NOW)).toBe(true);
  });
});

describe("M1 — weak or disputed items never ride on a different effect", () => {
  it("a disputed 'road closed' post next to congestion does not close the road", () => {
    const news = ev({ type: "NEWS_REPORT", sourceType: "NEWS", authorityLevel: "MEDIA_REPORT", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "BLOCKS_ROAD", radiusM: 300 }], coordinatorReview: { status: "DISPUTED", by: "E", at: NOW.toISOString() } });
    const jam = ev({ type: "CONGESTION", sourceType: "AZURE_MAPS_TRAFFIC", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "SLOWS_ROAD" }] });
    const { restrictions, slowdowns } = restrictionsFrom(correlate([news, jam], NOW));
    expect(restrictions).toEqual([]);
    expect(slowdowns).toHaveLength(1);
  });

  it("advisory-only CAD does not corroborate a news closure", () => {
    const news = ev({ type: "NEWS_REPORT", sourceType: "NEWS", authorityLevel: "MEDIA_REPORT", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "BLOCKS_ROAD" }] });
    const cad = ev({ type: "PUBLIC_SAFETY_INCIDENT", sourceType: "PUBLIC_CAD", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "ADVISORY" }] });
    expect(restrictionsFrom(correlate([news, cad], NOW)).restrictions).toEqual([]);
  });
});

describe("L6 — a blockage at the job site is the job", () => {
  it("still routes a crew to a site whose own road is blocked", () => {
    const atSite = closure([CAVE_SPRING.lng, CAVE_SPRING.lat]);
    const { restrictions } = restrictionsFrom(correlate([atSite], NOW));
    expect(planDeterministicRoute({ origin: JORDAN, destination: CAVE_SPRING, restrictions, version: 1, now: NOW })).not.toBeNull();
  });
});
