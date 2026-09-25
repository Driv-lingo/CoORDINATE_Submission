import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@/data/memoryRepository";
import { LIVE_WS, workspaceMode } from "@/data/mode";
import type { OperationalEvent } from "@/domain/ops";
import type { Mission } from "@/domain/types";
import { isStale } from "@/engine/correlate";
import { ingestSnapshot, liveDocId } from "@/live/ingest";
import { parseNwsAlerts } from "@/providers/nws";
import { liveProviderHealth, resetLiveRegistry } from "@/providers/registry";
import type { Ctx } from "@/server/context";
import { buildLiveView, buildOpsView, injectScenario } from "@/server/ops";
import { situationFor } from "@/server/situation";
import { buildIncidentDetail } from "@/server/views";

/**
 * Dual mode: /demo (scenario provider) vs /live (live provider).
 * Only NWS is enabled in tests (the other feeds need configuration); `fetch` is stubbed.
 */

const COORD: Ctx["persona"] = { kind: "coordinator", id: "coord-ellis", name: "Ellis Morgan" };
const ctx = (ws: string, now = new Date()): Ctx => ({ repo: new MemoryRepository(), ws, persona: COORD, now });
const inMin = (min: number, from = new Date()) => new Date(from.getTime() + min * 6e4).toISOString();
const square = [
  [-80.02, 37.22],
  [-79.95, 37.22],
  [-79.95, 37.28],
  [-80.02, 37.28],
  [-80.02, 37.22],
];

function nwsFeature(id: string, event: string, extra: Record<string, unknown> = {}) {
  return {
    id: `https://api.weather.gov/alerts/${id}`,
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [square] },
    properties: {
      "@id": `https://api.weather.gov/alerts/${id}`,
      id,
      event,
      areaDesc: "Roanoke, VA",
      headline: `${event} issued for Roanoke`,
      severity: "Severe",
      status: "Actual",
      messageType: "Alert",
      sent: inMin(-10),
      expires: inMin(90),
      senderName: "NWS Blacksburg VA",
      ...extra,
    },
  };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/geo+json" } });

async function clearLive() {
  resetLiveRegistry();
  await new MemoryRepository().resetWorkspace(LIVE_WS);
}

beforeEach(clearLive);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("per-route data mode", () => {
  it("/live is the only live workspace; no global switch makes anything else live", () => {
    const prev = process.env.COORDINATE_DATA_MODE;
    process.env.COORDINATE_DATA_MODE = "live";
    try {
      expect(workspaceMode(LIVE_WS)).toBe("LIVE");
      expect(workspaceMode("sbx-00000000000000b1")).toBe("SCENARIO");
      expect(workspaceMode("op-delphine")).toBe("SCENARIO");
      expect(situationFor("sbx-00000000000000b1").mode).toBe("SCENARIO");
      expect(situationFor(LIVE_WS).mode).toBe("LIVE");
    } finally {
      if (prev === undefined) delete process.env.COORDINATE_DATA_MODE;
      else process.env.COORDINATE_DATA_MODE = prev;
    }
  });

  it("/demo never contacts live providers and works with every external service down", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network is down");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const c = ctx("sbx-00000000000000b2");
    const view = await buildOpsView(c);
    expect(view.mode).toBe("SCENARIO");
    expect(view.clusters.length).toBeGreaterThan(0);
    expect(view.clusters.every((cl) => cl.simulated)).toBe(true);
    const after = await injectScenario(c, { inject: "collision-closure" });
    expect(after.missions.length).toBeGreaterThan(0);
    const [inc] = await c.repo.listIncidents(c.ws);
    await buildIncidentDetail(c, inc.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("/live", () => {
  it("shows real NWS alerts with provenance, and nothing simulated", async () => {
    const fetchSpy = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.weather.gov/alerts/active?area=VA");
      return jsonResponse({ features: [nwsFeature("urn:oid:tor.1", "Tornado Warning", { severity: "Extreme" }), nwsFeature("urn:oid:wind.2", "Wind Advisory", { severity: "Minor" })] });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const v = await buildLiveView(ctx("sbx-00000000000000b3"));
    expect(v.mode).toBe("LIVE");
    expect(v.events.map((e) => e.provenance.sourceId).sort()).toEqual(["urn:oid:tor.1", "urn:oid:wind.2"]);
    expect(v.events.every((e) => e.current && e.sourceHealth === "healthy")).toBe(true);
    expect(v.sources.find((s) => s.id === "nws")?.level).toBe("healthy");
    expect(v.lastUpdatedAt).toBeDefined();
    expect(v.missions).toEqual([]);
    expect(v.clusters.every((c) => !c.simulated)).toBe(true);
    // Raw payloads stay in storage for audit and never reach the browser.
    expect(JSON.stringify(v)).not.toContain('"raw"');
    const stored = await new MemoryRepository().listEvents(LIVE_WS);
    expect(stored.every((e) => e.raw && e.provenance?.rawHash)).toBe(true);
    expect(await new MemoryRepository().listIncidents(LIVE_WS)).toEqual([]);
  });

  it("never substitutes simulated incidents when the provider fails, and the dashboard still renders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ title: "Service Unavailable" }, 503)));
    const v = await buildLiveView(ctx("sbx-00000000000000b4"));
    expect(v.events).toEqual([]);
    expect(v.clusters).toEqual([]);
    expect(v.missions).toEqual([]);
    expect(v.sources.find((s) => s.id === "nws")).toMatchObject({ level: "offline" });
    expect(v.lastUpdatedAt).toBeUndefined();
  });

  it("does not crash on a malformed feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not json</html>", { status: 200 })));
    const v = await buildLiveView(ctx("sbx-00000000000000b5"));
    expect(v.events).toEqual([]);
    expect(v.sources.find((s) => s.id === "nws")?.level).toBe("offline");
  });

  it("labels earlier data as stale (never current) when the source later fails or goes quiet", async () => {
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (fail ? jsonResponse({}, 500) : jsonResponse({ features: [nwsFeature("urn:oid:svr.3", "Severe Thunderstorm Warning")] }))),
    );
    const first = await buildLiveView(ctx("sbx-00000000000000b6"));
    expect(first.events[0].current).toBe(true);

    // Four minutes without a successful fetch (NWS polls every 60 s): the source is STALE.
    const later = new Date(Date.now() + 4 * 60e3);
    expect(liveProviderHealth(later).find((h) => h.id === "nws")?.state).toBe("STALE");
    fail = true;
    const second = await buildLiveView(ctx("sbx-00000000000000b6", later));
    expect(second.events).toHaveLength(1);
    expect(second.events[0].current).toBe(false);
    expect(["stale", "degraded", "offline"]).toContain(second.events[0].sourceHealth);
    expect(second.lastUpdatedAt).toBeUndefined();
  });
});

describe("ingest pipeline", () => {
  const now = new Date();
  const parse = (features: unknown[], at = now) => parseNwsAlerts({ features }, at);

  it("keeps provenance through normalization and storage", async () => {
    const [e] = parse([nwsFeature("urn:oid:ffw.9", "Flash Flood Warning")]);
    expect(e.provenance).toMatchObject({
      source: "nws",
      sourceId: "urn:oid:ffw.9",
      sourceUrl: "https://api.weather.gov/alerts/urn:oid:ffw.9",
      status: "active",
    });
    expect(e.provenance?.sourceUpdatedAt).toBeDefined();
    expect(e.provenance?.sourceUpdatedAt).toBe(e.eventTime);
    expect(e.provenance?.expiresAt).toBe(e.expiresAt);
    expect(e.provenance?.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect((e.raw as { properties: { id: string } }).properties.id).toBe("urn:oid:ffw.9");

    const repo = new MemoryRepository();
    await ingestSnapshot(repo, "nws", [e], now);
    const [stored] = await repo.listEvents(LIVE_WS);
    expect(stored.id).toBe(liveDocId("nws", "urn:oid:ffw.9"));
    expect(stored.provenance).toMatchObject({ source: "nws", sourceId: "urn:oid:ffw.9", sourceUrl: e.provenance!.sourceUrl, sourceUpdatedAt: e.provenance!.sourceUpdatedAt, rawHash: e.provenance!.rawHash, ingestedAt: now.toISOString() });
    expect(stored.raw).toEqual(e.raw);
  });

  it("upserts duplicates instead of adding them, updates changed items and clears ones the source dropped", async () => {
    const repo = new MemoryRepository();
    const a = nwsFeature("urn:oid:a", "Flood Warning");
    const b = nwsFeature("urn:oid:b", "Wind Advisory");
    // The same item twice in one batch is stored once.
    const r1 = await ingestSnapshot(repo, "nws", parse([a, a, b]), now);
    expect([r1.inserted, r1.updated, r1.unchanged]).toEqual([2, 0, 0]);
    // Re-fetching the identical feed adds nothing.
    const r2 = await ingestSnapshot(repo, "nws", parse([a, b]), new Date(now.getTime() + 60e3));
    expect([r2.inserted, r2.updated, r2.unchanged, r2.changed]).toEqual([0, 0, 2, false]);
    expect((await repo.listEvents(LIVE_WS)).length).toBe(2);
    // An upstream update replaces the stored copy.
    const a2 = nwsFeature("urn:oid:a", "Flood Warning", { headline: "Flood Warning extended" });
    const r3 = await ingestSnapshot(repo, "nws", parse([a2]), new Date(now.getTime() + 120e3));
    expect([r3.inserted, r3.updated, r3.cleared]).toEqual([0, 1, 1]);
    const stored = await repo.listEvents(LIVE_WS);
    expect(stored.length).toBe(2);
    expect(stored.find((e) => e.provenance?.sourceId === "urn:oid:a")?.description).toMatch(/extended/);
    // The dropped item is kept for audit, marked cleared.
    expect(stored.find((e) => e.provenance?.sourceId === "urn:oid:b")?.provenance?.status).toBe("cleared");
  });

  it("rejects items without provenance or with simulated data", async () => {
    const repo = new MemoryRepository();
    const [good] = parse([nwsFeature("urn:oid:ok", "Flood Warning")]);
    const simulated = { ...good, id: "sim", simulated: true } as OperationalEvent;
    const bare = { ...good, id: "bare", provenance: undefined } as OperationalEvent;
    const r = await ingestSnapshot(repo, "nws", [good, simulated, bare], now);
    expect(r.inserted).toBe(1);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["missing provenance", "not a live item"]);
  });

  it("detects stale and expired timestamps", () => {
    const [e] = parse([nwsFeature("urn:oid:s", "Special Weather Statement", { expires: undefined, ends: undefined })]);
    expect(isStale(e, now)).toBe(false);
    // A feed condition with no expiry goes stale when no fetch has listed it for too long.
    expect(isStale({ ...e, eventTime: inMin(-600, now), fetchedAt: inMin(-600, now) }, now)).toBe(true);
    // An expired alert is stale regardless of fetch time.
    expect(isStale({ ...e, expiresAt: inMin(-1, now) }, now)).toBe(true);
    // Parsing drops alerts that have already expired.
    expect(parse([nwsFeature("urn:oid:old", "Flood Warning", { expires: inMin(-5, now) })])).toEqual([]);
  });
});

describe("live operation end to end", () => {
  it("a registered, verified volunteer is matched to a real request, and the team can go without a vacuum", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ features: [] })));
    const { registerVolunteer, submitIntake, incidentAction, missionAction, responderAction } = await import("@/server/actions");
    const repo = new MemoryRepository();
    await repo.resetWorkspace(LIVE_WS);
    const coordinator: Ctx = { repo, ws: LIVE_WS, persona: { kind: "coordinator", id: "coordinator", name: "Coordinator" }, now: new Date() };
    const resident: Ctx = { ...coordinator, persona: { kind: "resident", id: "res-abc", name: "Resident" } };

    // Nothing fictional in the live operation.
    expect(await repo.listResponders(LIVE_WS)).toEqual([]);
    expect(await repo.listIncidents(LIVE_WS)).toEqual([]);

    const sam = await registerVolunteer(resident, { name: "Sam Rivera", locationText: "Cave Spring", maxTravelKm: 25, skills: ["GENERAL_LABOR", "FLOOD_CLEANUP"], assets: [{ type: "WATER_PUMP", quantity: 1 }] }, "sbx-0000000000000abc");
    expect(sam.identityVerified).toBe(false);
    expect(sam.ownerKey).toBe("sbx-0000000000000abc");

    const inc = await submitIntake(resident, { text: "Our basement is flooded with about a foot of standing water. Nobody is hurt.", locationText: "Cave Spring", accessibilityNeeds: [], immediateDanger: false });
    expect(inc.workspaceId).toBe(LIVE_WS);
    const offered = inc.needs.filter((n) => n.status === "HELP_AVAILABLE").map((n) => n.id);
    await incidentAction(resident, inc.id, { action: "request-help", needIds: offered });

    // Unverified identity: the gates refuse the only volunteer.
    const first = (await incidentAction(coordinator, inc.id, { action: "propose" })) as { mission?: Mission };
    expect(first.mission?.assignments.some((a) => a.responderId === sam.id)).toBe(false);
    await missionAction(coordinator, first.mission!.id, { action: "cancel", note: "re-staff after verification" });

    // A coordinator verifies identity; Sam completes the flood-safety module.
    await responderAction(coordinator, sam.id, { action: "verify-identity" });
    await responderAction({ ...coordinator, persona: { kind: "responder", id: sam.id, name: sam.name } }, sam.id, { action: "complete-training", moduleId: "FLOOD_CLEANUP_SAFETY" });

    const second = (await incidentAction(coordinator, inc.id, { action: "propose" })) as { mission?: Mission };
    const m = second.mission!;
    expect(m.assignments.map((a) => a.slotId).sort()).toEqual(["flood-1", "pump"]);
    expect(m.unfilledSlotIds).toEqual(["vac"]);
    await expect(missionAction(coordinator, m.id, { action: "dispatch" })).rejects.toThrow(/Dispatch blocked/);
    const d = await missionAction(coordinator, m.id, { action: "dispatch", allowPartial: true, note: "Resident has a mop and buckets" });
    expect(d.mission.status).toBe("DISPATCHED");
    expect(d.mission.dispatchedWithout?.labels).toEqual(["Wet/dry vacuum"]);
  });
});
