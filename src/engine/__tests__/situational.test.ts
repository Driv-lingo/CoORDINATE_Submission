import { describe, expect, it } from "vitest";
import type { OperationalEvent } from "@/domain/ops";
import type { Mission } from "@/domain/types";
import { correlate, isStale, restrictionsFrom } from "@/engine/correlate";
import { circlePolygon, pathAffected, pointAffected, pointInPolygon } from "@/engine/geometry";
import { acknowledgeRoute, applyAssessment, attachRoute, dispatch, LifecycleError, proposeTeam, resumeMission } from "@/engine/lifecycle";
import { assessMission } from "@/engine/reassess";
import { routeConflicts, routeOnGraph } from "@/engine/routing";
import { intake, NOW, TREE_TEXT, world } from "./helpers";

const JORDAN = { lat: 37.287, lng: -80.045, label: "Jordan (Salem)" };
const CAVE_SPRING = { lat: 37.2275, lng: -80.001, label: "Cave Spring" };
const RTE419_CRASH: [number, number] = [-80.0175, 37.2545];

let seq = 0;
function ev(p: Partial<OperationalEvent> & Pick<OperationalEvent, "type" | "sourceType" | "authorityLevel" | "geometry">): OperationalEvent {
  seq++;
  return {
    id: `ev-${seq}`,
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

const vdotClosure = () => ev({ type: "ROAD_CLOSURE", sourceType: "VIRGINIA_511", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "BLOCKS_ROAD" }] });

describe("geometry", () => {
  it("intersects points, paths and polygons", () => {
    const poly = circlePolygon([-79.93, 37.24], 2000);
    expect(pointAffected([-79.93, 37.24], poly)).toBe(true);
    expect(pointAffected([-80.05, 37.29], poly)).toBe(false);
    expect(pathAffected([[-79.97, 37.24], [-79.89, 37.24]], poly)).toBe(true);
    expect(pointInPolygon([0.5, 0.5], [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]])).toBe(true);
  });
});

describe("safe routing", () => {
  it("routes via Rte 419, then around a verified closure with a longer ETA", () => {
    const a = routeOnGraph({ origin: JORDAN, destination: CAVE_SPRING, restrictions: [], version: 1, now: NOW })!;
    expect(a.roads[0]).toMatch(/419/);
    const { restrictions } = restrictionsFrom(correlate([vdotClosure()], NOW));
    expect(routeConflicts(a.path, restrictions)).toHaveLength(1);
    const b = routeOnGraph({ origin: JORDAN, destination: CAVE_SPRING, restrictions, version: 2, now: NOW })!;
    expect(routeConflicts(b.path, restrictions)).toHaveLength(0);
    expect(b.etaMinutes).toBeGreaterThan(a.etaMinutes);
    expect(b.statement).toMatch(/avoids currently known closures/);
    expect(a.statement).not.toMatch(/\bsafe\b/i);
  });

  it("returns no route (never routes through) when every path is blocked", () => {
    const wall = { clusterId: "x", title: "wall", geometry: circlePolygon([-80.001, 37.2275], 1800), radiusM: 0, kind: "AVOID_AREA" as const };
    expect(routeOnGraph({ origin: JORDAN, destination: { ...CAVE_SPRING, lat: 37.2276 }, restrictions: [wall], version: 1, now: NOW })).toBeNull();
  });
});

describe("correlation & provenance", () => {
  it("an unverified news report cannot independently trigger a reroute", () => {
    const news = ev({ type: "NEWS_REPORT", sourceType: "NEWS", authorityLevel: "MEDIA_REPORT", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "BLOCKS_ROAD" }] });
    const [c] = correlate([news], NOW);
    expect(c.status).toBe("UNVERIFIED");
    expect(c.actionableEffects).toEqual([]);
    expect(c.pendingEffects[0].reason).toMatch(/awaiting corroboration/);
    expect(restrictionsFrom([c]).restrictions).toEqual([]);
  });

  it("a machine camera observation alone cannot establish a closure", () => {
    const cam = ev({ type: "CAMERA_OBSERVATION", category: "CAMERA", sourceType: "PUBLIC_CAMERA", authorityLevel: "MACHINE_DERIVED_OBSERVATION", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "BLOCKS_ROAD" }], camera: { cameraId: "c1", cameraName: "Cam", observationType: "ROAD_BLOCKED", machineGenerated: true, humanVerified: false } });
    const [c] = correlate([cam], NOW);
    expect(c.actionableEffects).toEqual([]);
  });

  it("camera + authoritative traffic incident corroborate into one actionable closure", () => {
    const slow = ev({ type: "TRAFFIC_CRASH", sourceType: "VIRGINIA_511", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA", geometry: { type: "Point", coordinates: RTE419_CRASH }, effects: [{ kind: "SLOWS_ROAD", delayMinutes: 6 }] });
    const cam = ev({ type: "CAMERA_OBSERVATION", category: "CAMERA", sourceType: "PUBLIC_CAMERA", authorityLevel: "MACHINE_DERIVED_OBSERVATION", geometry: { type: "Point", coordinates: [RTE419_CRASH[0] + 0.001, RTE419_CRASH[1]] }, effects: [{ kind: "BLOCKS_ROAD" }] });
    const clusters = correlate([slow, cam], NOW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].status).toBe("CORROBORATED");
    expect(clusters[0].confidence).toBe("HIGH");
    // The official source says "slow"; a camera AI alone cannot upgrade that to "blocked" (A3, review M1).
    expect(clusters[0].actionableEffects.map((e) => e.kind)).toEqual(["SLOWS_ROAD"]);
    expect(clusters[0].pendingEffects.map((p) => p.effect.kind)).toEqual(["BLOCKS_ROAD"]);
    // When the official source also reports a closure, the camera corroborates it.
    const closed = { ...slow, effects: [{ kind: "BLOCKS_ROAD" as const }] };
    const [both] = correlate([closed, cam], NOW);
    expect(both.actionableEffects.map((e) => e.kind)).toEqual(["BLOCKS_ROAD"]);
    expect(both.actionableAreas.map((a) => a.eventId).sort()).toEqual([closed.id, cam.id].sort());
  });

  it("keeps different areas separate and preserves every supporting report", () => {
    const r1 = ev({ type: "COMMUNITY_REPORT", category: "COMMUNITY", sourceType: "COMMUNITY", authorityLevel: "COMMUNITY_REPORT", sourceId: "res-1", geometry: { type: "Point", coordinates: [-79.95, 37.26] } });
    const r2 = ev({ type: "COMMUNITY_REPORT", category: "COMMUNITY", sourceType: "COMMUNITY", authorityLevel: "COMMUNITY_REPORT", sourceId: "res-2", geometry: { type: "Point", coordinates: [-79.9505, 37.2601] } });
    const far = ev({ type: "COMMUNITY_REPORT", category: "COMMUNITY", sourceType: "COMMUNITY", authorityLevel: "COMMUNITY_REPORT", sourceId: "res-3", geometry: { type: "Point", coordinates: [-80.05, 37.29] } });
    const clusters = correlate([r1, r2, far], NOW);
    expect(clusters).toHaveLength(2);
    expect(clusters.find((c) => c.memberIds.length === 2)?.evidence).toHaveLength(2);
  });

  it("expired events drop out and stale observations lose operational relevance", () => {
    const expired = { ...vdotClosure(), expiresAt: new Date(NOW.getTime() - 60e3).toISOString() };
    expect(correlate([expired], NOW)).toEqual([]);
    const oldCam = ev({ type: "CAMERA_OBSERVATION", sourceType: "PUBLIC_CAMERA", authorityLevel: "MACHINE_DERIVED_OBSERVATION", geometry: { type: "Point", coordinates: RTE419_CRASH }, eventTime: new Date(NOW.getTime() - 45 * 6e4).toISOString(), effects: [{ kind: "BLOCKS_ROAD" }] });
    expect(isStale(oldCam, NOW)).toBe(true);
    const [c] = correlate([vdotClosure(), oldCam], NOW);
    expect(c.evidence.find((e) => e.eventId === oldCam.id)?.stale).toBe(true);
  });
});

function dispatchedTreeMission() {
  const w = world();
  const inc = intake(TREE_TEXT);
  const p = proposeTeam({ incident: inc, responders: w.responders, missions: w.missions, missionNumber: 21, actor: "engine", now: NOW });
  const d = dispatch({ incident: p.incident, mission: p.mission, responders: w.responders, missions: w.missions, actorName: "E", now: NOW });
  const route = routeOnGraph({ origin: JORDAN, destination: CAVE_SPRING, restrictions: [], version: 1, now: NOW })!;
  return attachRoute(d.incident, d.mission, route, NOW);
}

describe("continuous mission reassessment", () => {
  it("reroutes a mobilizing team when a verified closure hits its route", () => {
    const { incident, mission } = dispatchedTreeMission();
    const clusters = correlate([vdotClosure()], NOW);
    const { restrictions } = restrictionsFrom(clusters);
    const a = assessMission({ mission, incident, clusters, restrictions });
    expect(a.outcome).toBe("REROUTE");
    const newRoute = routeOnGraph({ origin: JORDAN, destination: CAVE_SPRING, restrictions, version: 2, now: NOW });
    const r = applyAssessment({ incident, mission, assessment: a, newRoute, now: NOW });
    expect(r.mission.status).toBe("REROUTING");
    expect(r.mission.route!.etaMinutes).toBeGreaterThan(mission.route!.etaMinutes);
    expect(r.mission.decisions!.at(-1)!.evidence.length).toBeGreaterThan(0);
    expect(acknowledgeRoute(r.incident, r.mission, "Jordan", NOW).mission.status).toBe("DISPATCHED");
    // Idempotent: the new route no longer conflicts.
    expect(assessMission({ mission: r.mission, incident: r.incident, clusters, restrictions }).outcome).toBe("CONTINUE");
  });

  it("holds a mission inside a tornado warning and never resumes while the warning is active", () => {
    const { incident, mission } = dispatchedTreeMission();
    const warning = ev({ type: "TORNADO_WARNING", category: "WEATHER", sourceType: "NWS", authorityLevel: "AUTHORITATIVE_ALERT", geometry: circlePolygon([-80.0, 37.23], 3000), expiresAt: new Date(NOW.getTime() + 30 * 6e4).toISOString(), effects: [{ kind: "HOLD_ALL_ACTIVITY" }] });
    const clusters = correlate([warning], NOW);
    const a = assessMission({ mission, incident, clusters, restrictions: [] });
    expect(a.outcome).toBe("HOLD");
    const held = applyAssessment({ incident, mission, assessment: a, now: NOW });
    expect(held.mission.status).toBe("ON_HOLD");
    expect(held.mission.hold?.ruleId).toBe("W-01");
    expect(() => resumeMission(held.incident, held.mission, "Ellis", NOW)).toThrow(LifecycleError);

    // Warning expires → hold condition cleared → coordinator can resume.
    const later = new Date(NOW.getTime() + 31 * 6e4);
    const after = assessMission({ mission: held.mission, incident: held.incident, clusters: correlate([warning], later), restrictions: [] });
    expect(after.holdCleared).toBe(true);
    const cleared = applyAssessment({ incident: held.incident, mission: held.mission, assessment: after, now: later });
    expect(resumeMission(cleared.incident, cleared.mission, "Ellis", later).mission.status).toBe("DISPATCHED");
  });

  it("severe thunderstorm holds outdoor work but not indoor work", () => {
    const { incident, mission } = dispatchedTreeMission();
    const storm = ev({ type: "SEVERE_THUNDERSTORM_WARNING", sourceType: "NWS", authorityLevel: "AUTHORITATIVE_ALERT", geometry: circlePolygon([-80.0, 37.23], 3000), effects: [{ kind: "HOLD_OUTDOOR_WORK" }] });
    const clusters = correlate([storm], NOW);
    expect(assessMission({ mission, incident, clusters, restrictions: [] }).outcome).toBe("HOLD");
    const indoor = { ...incident, assessment: { ...incident.assessment, needs: ["MUCK_OUT" as const] } };
    expect(assessMission({ mission: mission as Mission, incident: indoor, clusters, restrictions: [] }).outcome).toBe("CONTINUE");
  });

  it("holds (never routes through) when no usable route exists", () => {
    const { incident, mission } = dispatchedTreeMission();
    const clusters = correlate([vdotClosure()], NOW);
    const a = assessMission({ mission, incident, clusters, restrictions: restrictionsFrom(clusters).restrictions });
    const r = applyAssessment({ incident, mission, assessment: a, newRoute: null, now: NOW });
    expect(r.mission.status).toBe("ON_HOLD");
    expect(r.mission.hold?.ruleId).toBe("R-02");
  });
});
