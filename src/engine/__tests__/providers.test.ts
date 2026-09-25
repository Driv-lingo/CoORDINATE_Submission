import { describe, expect, it } from "vitest";
import { correlate } from "@/engine/correlate";
import { parseAzureTraffic } from "@/providers/azureTraffic";
import { parseCapAlerts } from "@/providers/ipaws";
import { parseNewsRss } from "@/providers/news";
import { parseNwsAlerts } from "@/providers/nws";
import { parsePublicCad } from "@/providers/publicCad";
import { liveProviderHealth } from "@/providers/registry";
import { parseCameras, parseVa511 } from "@/providers/va511";
import { NOW } from "./helpers";

const later = (min: number) => new Date(NOW.getTime() + min * 6e4).toISOString();
const square = [
  [-80.02, 37.22],
  [-79.95, 37.22],
  [-79.95, 37.28],
  [-80.02, 37.28],
  [-80.02, 37.22],
];

describe("NWS alerts parser", () => {
  const feed = {
    features: [
      {
        id: "https://api.weather.gov/alerts/urn:oid:tor.1",
        geometry: { type: "Polygon", coordinates: [square] },
        properties: { id: "urn:oid:tor.1", event: "Tornado Warning", areaDesc: "Roanoke, VA", severity: "Extreme", status: "Actual", messageType: "Alert", sent: NOW.toISOString(), expires: later(30), senderName: "NWS Blacksburg VA" },
      },
      { geometry: null, properties: { id: "urn:oid:ffw.2", event: "Flash Flood Warning", status: "Actual", messageType: "Alert", expires: later(120), affectedZones: ["https://api.weather.gov/zones/forecast/VAZ022"] } },
      { geometry: { type: "Polygon", coordinates: [square] }, properties: { id: "t", event: "Tornado Warning", status: "Test", expires: later(30) } },
      { geometry: { type: "Polygon", coordinates: [square] }, properties: { id: "c", event: "Tornado Warning", status: "Actual", messageType: "Cancel", expires: later(30) } },
      { geometry: { type: "Polygon", coordinates: [square] }, properties: { id: "old", event: "Severe Thunderstorm Warning", status: "Actual", expires: later(-5) } },
    ],
  };
  const events = parseNwsAlerts(feed, NOW, (z) => (z.endsWith("VAZ022") ? { type: "Polygon", coordinates: [square] } : undefined) as never);

  it("maps warnings to effects and skips tests, cancellations and expired alerts", () => {
    expect(events.map((e) => e.type)).toEqual(["TORNADO_WARNING", "FLASH_FLOOD_WARNING"]);
    expect(events[0].effects).toEqual([{ kind: "HOLD_ALL_ACTIVITY" }]);
    expect(events[0].authorityLevel).toBe("AUTHORITATIVE_ALERT");
    expect(events[0].mode).toBe("LIVE");
    expect(events[0].simulated).toBe(false);
  });

  it("uses zone geometry when the alert has no polygon", () => {
    expect(events[1].geometry.type).toBe("Polygon");
  });
});

describe("IPAWS CAP parser", () => {
  const cap = `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>VA-EVAC-7</identifier><sender>roanokeco@example.gov</sender><sent>${NOW.toISOString()}</sent>
    <status>Actual</status><msgType>Alert</msgType>
    <info><event>Evacuation Immediate</event><urgency>Immediate</urgency><severity>Extreme</severity><certainty>Observed</certainty>
      <expires>${later(90)}</expires><headline>Evacuate low-lying areas along Tinker Creek</headline>
      <area><areaDesc>Tinker Creek corridor</areaDesc><polygon>37.28,-79.93 37.30,-79.93 37.30,-79.91 37.28,-79.91 37.28,-79.93</polygon></area>
    </info></alert>`;
  it("parses a CAP evacuation into a NO_CIVILIAN_ENTRY area with lon/lat order", () => {
    const [e] = parseCapAlerts(cap, NOW);
    expect(e.type).toBe("EVACUATION");
    expect(e.effects[0].kind).toBe("NO_CIVILIAN_ENTRY");
    expect(e.geometry.type).toBe("Polygon");
    expect((e.geometry as { coordinates: number[][][] }).coordinates[0][0]).toEqual([-79.93, 37.28]);
  });
  it("ignores exercise messages", () => {
    expect(parseCapAlerts(cap.replace("<status>Actual</status>", "<status>Exercise</status>"), NOW)).toEqual([]);
  });
});

describe("Azure Maps traffic parser", () => {
  it("reads v1 tm.poi (with expanded clusters) inside the operation area", () => {
    const v1 = {
      tm: {
        poi: [
          { id: "a1", p: { x: -80.0175, y: 37.2545 }, ic: 8, ty: 4, d: "Closed", r: "VA-419", f: "Keagy Rd", t: "Brambleton Ave" },
          { id: "cl", p: { x: -79.95, y: 37.27 }, ic: 13, cpoi: [{ id: "j1", p: { x: -79.944, y: 37.3 }, ic: 6, ty: 2, dl: 420, r: "US-11" }] },
          { id: "far", p: { x: -77.4, y: 37.5 }, ic: 1, ty: 3 },
        ],
      },
    };
    const events = parseAzureTraffic(v1, NOW);
    expect(events.map((e) => e.id)).toEqual(["azm-a1", "azm-j1"]);
    expect(events[0].effects[0].kind).toBe("BLOCKS_ROAD");
    expect(events[1].effects[0]).toMatchObject({ kind: "SLOWS_ROAD", delayMinutes: 7 });
  });
  it("reads GeoJSON-style incidents", () => {
    const gj = { features: [{ id: "g1", geometry: { type: "LineString", coordinates: [[-79.99, 37.23], [-79.98, 37.235]] }, properties: { incidentType: "RoadClosed", description: "Flooding" } }] };
    const [e] = parseAzureTraffic(gj, NOW);
    expect(e.type).toBe("ROAD_CLOSURE");
    expect(e.effects[0].kind).toBe("BLOCKS_ROAD");
  });
});

describe("Virginia 511 / VDOT parsers", () => {
  it("reads WZDx work zones and classifies full closures", () => {
    const wzdx = {
      features: [
        {
          id: "wz-1",
          geometry: { type: "LineString", coordinates: [[-80.0, 37.25], [-79.99, 37.255]] },
          properties: { core_details: { event_type: "work-zone", road_names: ["Colonial Ave"], description: "Bridge repair" }, vehicle_impact: "all-lanes-closed", start_date: NOW.toISOString(), end_date: later(600) },
        },
        { id: "inc-2", geometry: { type: "Point", coordinates: [-79.94, 37.27] }, properties: { EventType: "Incident", Description: "Crash, right lane blocked", RoadwayName: "I-581" } },
      ],
    };
    const [wz, crash] = parseVa511(wzdx, NOW);
    expect(wz).toMatchObject({ type: "ROAD_WORK", roadName: "Colonial Ave", authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA" });
    expect(wz.effects[0].kind).toBe("BLOCKS_ROAD");
    expect(crash.type).toBe("TRAFFIC_CRASH");
    expect(crash.effects[0].kind).toBe("SLOWS_ROAD");
  });
  it("reads camera lists and drops non-HTTPS snapshot URLs", () => {
    const cams = parseCameras([
      { id: "c1", name: "I-581 @ Elm", lat: 37.2745, lon: -79.9385, image_url: "https://example.org/c1.jpg" },
      { id: "c2", name: "Insecure", lat: 37.27, lon: -79.94, image_url: "http://example.org/c2.jpg" },
    ]);
    expect(cams[0].snapshotUrl).toBe("https://example.org/c1.jpg");
    expect(cams[1].snapshotUrl).toBeUndefined();
  });
});

describe("public CAD parser", () => {
  it("keeps CAD advisory-only and never reconstructs withheld locations", () => {
    const events = parsePublicCad(
      [
        { id: "1", nature: "Structure fire", address: "1200 blk Main St", latitude: 37.27, longitude: -79.94 },
        { id: "2", nature: "Medical — details withheld", latitude: 37.26, longitude: -79.95 },
        { id: "3", nature: "Traffic stop", address: "Somewhere" },
      ],
      NOW,
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.effects.every((x) => x.kind === "ADVISORY"))).toBe(true);
    expect(events[1].publicDetailLevel).toBe("AREA_ONLY");
    expect(events[1].title).toMatch(/withheld/);
  });
});

describe("news RSS parser", () => {
  const rss = `<rss><channel>
    <item><title>Crews: Grandin Road closed after tree falls</title><link>https://news.example/1</link><pubDate>${new Date(NOW.getTime() - 3600e3).toUTCString()}</pubDate></item>
    <item><title>School board meets Tuesday</title><link>https://news.example/2</link></item>
  </channel></rss>`;
  it("keeps relevant local items as unverified media reports", () => {
    const [e, ...rest] = parseNewsRss(rss, "news.example", NOW);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({ type: "NEWS_REPORT", authorityLevel: "MEDIA_REPORT", verificationStatus: "UNVERIFIED" });
  });
  it("a closure headline alone never produces an actionable restriction", () => {
    const clusters = correlate(parseNewsRss(rss, "news.example", NOW), NOW);
    expect(clusters[0].actionableEffects).toEqual([]);
    expect(clusters[0].pendingEffects[0].effect.kind).toBe("BLOCKS_ROAD");
  });
});

describe("provider health", () => {
  it("never reports a partner-only source as live, and reports unconfigured feeds as such", () => {
    const h = liveProviderHealth(NOW);
    expect(h.find((p) => p.id === "ring")!.state).toBe("PARTNER_REQUIRED");
    expect(h.find((p) => p.id === "pulsepoint-partner")!.state).toBe("PARTNER_REQUIRED");
    expect(h.find((p) => p.id === "va511")!.state).toBe("NOT_CONFIGURED");
    expect(h.filter((p) => p.state === "LIVE")).toEqual([]);
  });
});

describe("parser robustness (one bad item never sinks the feed)", () => {
  it("skips malformed NWS features and invalid geometry", () => {
    const events = parseNwsAlerts(
      {
        features: [
          { geometry: { type: "Polygon", coordinates: null }, properties: { id: "bad-geom", event: "Tornado Warning", status: "Actual", expires: later(30) } },
          { geometry: { type: "Polygon", coordinates: [square] }, properties: { id: "bad-zones", event: 42, affectedZones: "VAZ022" } },
          null,
          { geometry: { type: "Polygon", coordinates: [square] }, properties: { id: "good", event: "Tornado Warning", status: "Actual", expires: later(30) } },
        ],
      },
      NOW,
    );
    expect(events.map((e) => e.originalId)).not.toContain("bad-geom");
    expect(events.map((e) => e.originalId)).toContain("good");
  });

  it("treats non-array collections as empty and skips LineStrings without coordinates", () => {
    expect(parseAzureTraffic({ features: "nope" }, NOW)).toEqual([]);
    expect(parseVa511({ features: { a: 1 } }, NOW)).toEqual([]);
    const ok = parseVa511(
      {
        features: [
          { id: "x", geometry: { type: "LineString" }, properties: { Description: "Road closed" } },
          { id: "y", geometry: { type: "Point", coordinates: [-79.94, 37.27] }, properties: { Description: "Road closed" } },
        ],
      },
      NOW,
    );
    expect(ok.map((e) => e.originalId)).toEqual(["y"]);
  });

  it("gives every news item its own id", () => {
    const rss = `<rss><channel>
      <item><title>Grandin Road closed after tree falls</title><link>https://www.news.example/a</link></item>
      <item><title>Crash closes Wasena bridge</title><link>https://www.news.example/b</link></item>
    </channel></rss>`;
    const ids = parseNewsRss(rss, "news.example", NOW).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
