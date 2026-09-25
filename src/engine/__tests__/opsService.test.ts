import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/data/memoryRepository";
import { LifecycleError, resumeMission } from "@/engine/lifecycle";
import { incidentAction, submitIntake } from "@/server/actions";
import type { Ctx } from "@/server/context";
import { buildOpsView, buildPublicHazards, cameraAction, injectScenario } from "@/server/ops";
import { buildIncidentDetail } from "@/server/views";
import { buildSeedWorld } from "@/data/seed";
import { communityReportFromIncident } from "@/data/scenarioOps";
import { correlate } from "@/engine/correlate";
import { applyAssessment } from "@/engine/lifecycle";
import { assessMission } from "@/engine/reassess";

/**
 * Integration: the operations service over the in-memory repository, exactly as
 * the API routes call it (minus HTTP).
 */
function ctx(ws: string, persona: Ctx["persona"] = { kind: "coordinator", id: "coord-ellis", name: "Ellis Morgan" }): Ctx {
  return { repo: new MemoryRepository(), ws, persona, now: new Date() };
}

describe("operations service", () => {
  it("holds missions under a tornado warning, refuses resume, and clears on expiry (W-01 → H-01)", async () => {
    const c = ctx("sbx-00000000000000a1");
    const v = await injectScenario(c, { inject: "tornado-warning" });
    const held = v.missions.filter((m) => m.status === "ON_HOLD");
    expect(held.map((m) => m.code).sort()).toEqual(["MSN-017", "MSN-018", "MSN-019"]);
    expect(held.every((m) => m.hold?.ruleId === "W-01")).toBe(true);
    // The oxygen household gets a welfare prompt for the coordinator.
    expect(held.find((m) => m.code === "MSN-019")?.hold?.welfareNote).toMatch(/EMS/);

    const [m] = (await c.repo.listMissions(c.ws)).filter((x) => x.status === "ON_HOLD");
    const inc = (await c.repo.getIncident(c.ws, m.incidentId))!;
    expect(() => resumeMission(inc, m, "Ellis Morgan", new Date())).toThrow(LifecycleError);

    const after = await injectScenario({ ...c, now: new Date() }, { inject: "end-warnings" });
    expect(after.missions.filter((x) => x.status === "ON_HOLD").every((x) => x.hold?.conditionCleared)).toBe(true);
  });

  it("only coordinators may inject exercise conditions", async () => {
    const c = ctx("sbx-00000000000000a2", { kind: "responder", id: "r-jordan", name: "Jordan Reyes" });
    await expect(injectScenario(c, { inject: "collision-closure" })).rejects.toMatchObject({ status: 403 });
  });

  it("keeps opt-in camera access purpose-bound, logged and revocable", async () => {
    const c = ctx("sbx-00000000000000a3");
    await expect(cameraAction(c, "cam-ring-walker", { action: "snapshot" })).rejects.toMatchObject({ status: 403 });
    await expect(cameraAction(c, "cam-ring-walker", { action: "snapshot", incidentId: "inc-roof" })).rejects.toMatchObject({ status: 403 });
    const denise = ctx("sbx-00000000000000a3", { kind: "resident", id: "resident-denise", name: "Denise Walker" });
    const revoked = await cameraAction(denise, "cam-ring-walker", { action: "revoke" });
    expect(revoked.camera.consent).toMatchObject({ revoked: true, active: false });
    expect(revoked.camera.accessLog?.at(-1)?.action).toMatch(/revoked/i);
    // A volunteer cannot revoke someone else's consent.
    const jordan = ctx("sbx-00000000000000a3", { kind: "responder", id: "r-jordan", name: "Jordan Reyes" });
    await expect(cameraAction(jordan, "cam-ring-walker", { action: "revoke" })).rejects.toMatchObject({ status: 403 });
  });

  it("hides private cameras from non-coordinators and keeps the public map free of people and resident wording", async () => {
    const c = ctx("sbx-00000000000000a4");
    const volunteer = await buildOpsView(ctx("sbx-00000000000000a4", { kind: "responder", id: "r-jordan", name: "Jordan Reyes" }));
    expect(volunteer.cameras.some((x) => x.consent)).toBe(false);
    // Routes reveal where volunteers start: only their own missions for volunteers, none for residents.
    expect(volunteer.missions).toEqual([]);
    const resident = await buildOpsView(ctx("sbx-00000000000000a4", { kind: "resident", id: "resident-denise", name: "Denise Walker" }));
    expect(resident.missions).toEqual([]);
    const lily = await buildOpsView(ctx("sbx-00000000000000a4", { kind: "responder", id: "r-lily", name: "Lily Tran" }));
    expect(lily.missions.map((m) => m.code)).toEqual(["MSN-019"]);
    const pub = await buildPublicHazards(c);
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/Resident report:|Heads up|water is over the road|resident-|r-jordan|MSN-|INC-|inc-|Opt-in camera/i);
    expect(text).toMatch(/"Resident reports"/); // generic source label only
    expect(pub.hazards.some((h) => h.title === "Riverland Rd closed — high water")).toBe(true);
    // Unverified social post is not public.
    expect(text).not.toMatch(/I-581/);
  });

  it("turns an information-only intake into an unverified community report", async () => {
    const c = ctx("sbx-00000000000000a5", { kind: "resident", id: "resident-denise", name: "Denise Walker" });
    const inc = await submitIntake(c, {
      text: "Heads up — a tree is down across both lanes of Colonial Ave near Cave Spring Ln. Just reporting it, no help needed.",
      locationText: "Cave Spring",
      location: { lat: 37.2322, lng: -79.9925 },
    });
    expect(inc.status).toBe("LOGGED");
    const events = await c.repo.listEvents(c.ws);
    const ev = events.find((e) => e.incidentId === inc.id);
    expect(ev).toMatchObject({ sourceType: "COMMUNITY", authorityLevel: "COMMUNITY_REPORT", verificationStatus: "UNVERIFIED" });
    const view = await buildOpsView({ ...c, persona: { kind: "coordinator", id: "coord-ellis", name: "Ellis Morgan" } });
    const cluster = view.clusters.find((cl) => cl.incidentIds.includes(inc.id))!;
    expect(cluster.actionableEffects).toEqual([]);
    expect(cluster.pendingEffects[0].effect.kind).toBe("BLOCKS_ROAD");
  });

  it("redacts routes and evidence in incident detail for anyone but coordinators and the team (M4)", async () => {
    const coord = ctx("sbx-00000000000000a6");
    // MSN-019 (oxygen) is dispatched with a route that starts at Lily's location.
    const full = (await buildIncidentDetail(coord, "inc-oxygen"))!;
    expect(full.mission?.route?.origin.label).toMatch(/Lily/);
    const resident = (await buildIncidentDetail(ctx("sbx-00000000000000a6", { kind: "resident", id: "resident-denise", name: "Denise Walker" }), "inc-oxygen"))!;
    expect(JSON.stringify(resident.mission?.route)).not.toMatch(/Lily|-79\.98/);
    expect(resident.mission?.route?.etaMinutes).toBe(full.mission?.route?.etaMinutes);
    expect(resident.evidence).toEqual([]);
    const lily = (await buildIncidentDetail(ctx("sbx-00000000000000a6", { kind: "responder", id: "r-lily", name: "Lily Tran" }), "inc-oxygen"))!;
    expect(lily.mission?.route?.origin.label).toMatch(/Lily/);
  });

  it("refuses opt-in snapshots for closed incidents and ends observations on revocation (L3)", async () => {
    const c = ctx("sbx-00000000000000a7");
    const inc = await submitIntake({ ...c, persona: { kind: "resident", id: "resident-denise", name: "Denise Walker" } }, {
      text: "A tree fell across my driveway and we cannot get out.",
      locationText: "Cave Spring",
      location: { lat: 37.2276, lng: -80.0006 },
    });
    await cameraAction(c, "cam-ring-walker", { action: "snapshot", incidentId: inc.id });
    expect((await c.repo.listEvents(c.ws)).some((e) => e.incidentId === inc.id && e.sourceType === "PRIVATE_CAMERA")).toBe(true);
    await c.repo.saveIncident({ ...inc, status: "RESOLVED" });
    await expect(cameraAction(c, "cam-ring-walker", { action: "snapshot", incidentId: inc.id })).rejects.toMatchObject({ status: 403 });
    await cameraAction(ctx("sbx-00000000000000a7", { kind: "resident", id: "resident-denise", name: "Denise Walker" }), "cam-ring-walker", { action: "revoke" });
    const obs = (await c.repo.listEvents(c.ws)).filter((e) => e.sourceType === "PRIVATE_CAMERA");
    expect(obs.every((e) => e.expiresAt && new Date(e.expiresAt) <= new Date() && !e.camera?.mediaReference)).toBe(true);
  });
});

describe("independence, live seeding and readiness", () => {
  it("counts anonymous reports as one source, distinct residents as two (M2)", () => {
    const base = { workspaceId: "w", createdAt: new Date().toISOString(), number: "INC-1", location: { lat: 37.2322, lng: -79.9925 } };
    const mk = (id: string, reporterId?: string) =>
      communityReportFromIncident({ ...base, id, request: { text: "Water over the road on Colonial Ave, no help needed.", reporterId } } as never, "SCENARIO");
    const anon = correlate([mk("i1"), mk("i2")], new Date());
    expect(anon[0].actionableEffects).toEqual([]);
    const two = correlate([mk("i3", "resident-a"), mk("i4", "resident-b")], new Date());
    expect(two[0].actionableEffects.map((e) => e.kind)).toEqual(["BLOCKS_ROAD"]);
  });

  it("never seeds anything fictional into the live workspace, and no env switch turns a sandbox live (M3)", () => {
    const prev = process.env.COORDINATE_DATA_MODE;
    process.env.COORDINATE_DATA_MODE = "live";
    try {
      const w = buildSeedWorld("live");
      expect([w.incidents.length, w.missions.length, w.responders.length, w.events.length, w.cameras.length]).toEqual([0, 0, 0, 0, 0]);
      // Mode is per workspace (route), not a global switch: sandboxes and the shared exercise stay scenario.
      expect(buildSeedWorld("sbx-00000000000000ff").events.length).toBeGreaterThan(0);
      expect(buildSeedWorld("op-delphine").incidents.length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.COORDINATE_DATA_MODE;
      else process.env.COORDINATE_DATA_MODE = prev;
    }
  });

  it("does not clear a hold while live data is incomplete (H4)", async () => {
    const c = ctx("sbx-00000000000000a8");
    await injectScenario(c, { inject: "tornado-warning" });
    const [m] = (await c.repo.listMissions(c.ws)).filter((x) => x.status === "ON_HOLD");
    const inc = (await c.repo.getIncident(c.ws, m.incidentId))!;
    // No conditions at all (e.g. an empty cache after a restart): the hold must stand.
    const a = assessMission({ mission: m, incident: inc, clusters: [], restrictions: [] });
    expect(applyAssessment({ incident: inc, mission: m, assessment: a, allowClear: false, now: new Date() }).changed).toBe(false);
  });

  it("only the reporting resident or a coordinator can request coordinated help, and handoff summaries stay with coordinators", async () => {
    const denise = { kind: "resident" as const, id: "resident-denise", name: "Denise Walker" };
    const c = ctx("sbx-00000000000000a9", denise);
    const inc = await submitIntake(c, { text: "A tree fell across our driveway and we can't get out. My mother uses a wheelchair and we don't know where we can stay tonight.", locationText: "Cave Spring", location: { lat: 37.2276, lng: -80.0006 } });
    expect(inc.status).toBe("GUIDED");
    const tree = inc.needs.filter((n) => n.path === "COMMUNITY_MISSION").map((n) => n.id);
    const other = ctx("sbx-00000000000000a9", { kind: "resident", id: "resident-other", name: "Someone Else" });
    await expect(incidentAction(other, inc.id, { action: "request-help", needIds: tree })).rejects.toMatchObject({ status: 403 });
    const volunteer = ctx("sbx-00000000000000a9", { kind: "responder", id: "r-lily", name: "Lily Tran" });
    await expect(incidentAction(volunteer, inc.id, { action: "request-help", needIds: tree })).rejects.toMatchObject({ status: 403 });
    const res = await incidentAction(c, inc.id, { action: "request-help", needIds: tree });
    expect(res.incident.status).toBe("OPEN");
    const residentView = (await buildIncidentDetail(c, inc.id))!;
    expect(residentView.incident.handoffs.every((h) => !h.summary)).toBe(true);
    const coordView = (await buildIncidentDetail(ctx("sbx-00000000000000a9"), inc.id))!;
    expect(coordView.incident.handoffs[0]?.summary?.text).toMatch(/Why:/);
    expect(Object.keys(coordView.navigator.services).length).toBeGreaterThan(0);
  });
});
