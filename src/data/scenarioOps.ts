import type { CameraResource, OperationalEffect, OperationalEvent, Position } from "@/domain/ops";
import type { Incident } from "@/domain/types";

/**
 * Operational events and cameras for the FICTIONAL TS Delphine scenario.
 *
 * Every item here is SIMULATED and labelled as such in the UI. The events use
 * the same OperationalEvent model the live providers produce, so correlation,
 * routing and reassessment run the identical code path in both modes.
 */

const MIN = 6e4;
const iso = (now: Date, minutes: number) => new Date(now.getTime() + minutes * MIN).toISOString();

type EventInit = Omit<OperationalEvent, "workspaceId" | "mode" | "simulated" | "fetchedAt" | "verificationStatus"> & Partial<Pick<OperationalEvent, "verificationStatus">>;

function scenarioEvent(ws: string, now: Date, e: EventInit): OperationalEvent {
  return {
    verificationStatus: e.authorityLevel.startsWith("AUTHORITATIVE") ? "AUTHORITATIVE" : "UNVERIFIED",
    ...e,
    workspaceId: ws,
    mode: "SCENARIO",
    simulated: true,
    fetchedAt: now.toISOString(),
  };
}

const point = (lat: number, lng: number) => ({ type: "Point" as const, coordinates: [lng, lat] as Position });
const rect = (south: number, west: number, north: number, east: number) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ] as Position[],
  ],
});

/** Scenario locations shared by events, cameras and the guided demo. */
export const SCENARIO_PLACES = {
  /** Rte 419 between Keagy Rd and Brambleton Ave — the demo crash. */
  crash419: { lat: 37.2545, lng: -80.0175 },
  camera419: { lat: 37.2538, lng: -80.0168 },
  camera581: { lat: 37.2745, lng: -79.9385 },
  riverland: { lat: 37.2497, lng: -79.9045 },
  colonialFlood: { lat: 37.2322, lng: -79.9925 },
  ringWalker: { lat: 37.2279, lng: -80.0005 },
};

/** Roanoke River corridor — context for flooding reports. */
const RIVER_CORRIDOR = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-80.085, 37.268],
      [-79.99, 37.262],
      [-79.935, 37.238],
      [-79.875, 37.252],
      [-79.875, 37.236],
      [-79.935, 37.222],
      [-79.995, 37.246],
      [-80.085, 37.256],
      [-80.085, 37.268],
    ] as Position[],
  ],
};

/** Southeast Roanoke / Garden City / Riverdale — the demo tornado warning. */
export const TORNADO_AREA = rect(37.226, -79.948, 37.264, -79.893);
/** Salem / Cave Spring — the optional severe-thunderstorm demo. */
export const TSTORM_AREA = rect(37.215, -80.075, 37.3, -79.985);

export function baselineEvents(ws: string, now: Date): OperationalEvent[] {
  return [
    scenarioEvent(ws, now, {
      id: "ev-nws-ffw-river",
      type: "FLASH_FLOOD_WARNING",
      category: "WEATHER",
      sourceId: "nws-sim",
      sourceName: "National Weather Service (simulated alert)",
      sourceType: "NWS",
      authorityLevel: "AUTHORITATIVE_ALERT",
      title: "Flash Flood Warning — Roanoke River corridor",
      description: "SIMULATED ALERT for the fictional TS Delphine exercise. Turn around, don't drown.",
      geometry: RIVER_CORRIDOR,
      severity: "SEVERE",
      urgency: "Immediate",
      certainty: "Likely",
      startsAt: iso(now, -240),
      expiresAt: iso(now, 300),
      effects: [{ kind: "ADVISORY" }],
    }),
    scenarioEvent(ws, now, {
      id: "ev-511-riverland",
      type: "ROAD_CLOSURE",
      category: "TRAFFIC",
      sourceId: "va511-sim",
      sourceName: "Virginia 511 / VDOT (simulated feed)",
      sourceType: "VIRGINIA_511",
      authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
      title: "Riverland Rd closed — high water",
      roadName: "Riverland Rd",
      geometry: point(SCENARIO_PLACES.riverland.lat, SCENARIO_PLACES.riverland.lng),
      severity: "MODERATE",
      eventTime: iso(now, -150),
      effects: [{ kind: "BLOCKS_ROAD", radiusM: 150 }],
    }),
    scenarioEvent(ws, now, {
      id: "ev-azm-williamson",
      type: "CONGESTION",
      category: "TRAFFIC",
      sourceId: "azure-maps-traffic-sim",
      sourceName: "Azure Maps Traffic (simulated in scenario mode)",
      sourceType: "AZURE_MAPS_TRAFFIC",
      authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
      title: "Heavy congestion — Williamson Rd northbound",
      roadName: "Williamson Rd (US 11)",
      geometry: { type: "LineString", coordinates: [[-79.943, 37.296], [-79.944, 37.318], [-79.945, 37.334]] },
      severity: "MINOR",
      eventTime: iso(now, -20),
      effects: [{ kind: "SLOWS_ROAD", radiusM: 250, delayMinutes: 4 }],
    }),
    scenarioEvent(ws, now, {
      id: "ev-cad-wasena",
      type: "PUBLIC_SAFETY_INCIDENT",
      category: "PUBLIC_SAFETY",
      sourceId: "public-cad-sim",
      sourceName: "Public CAD feed (simulated, delayed)",
      sourceType: "PUBLIC_CAD",
      authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
      title: "Public-safety activity — Wasena (details withheld by source)",
      description: "The source redacts details for this call type. CoORDINATE does not attempt to reconstruct them.",
      geometry: point(37.259, -79.955),
      publicDetailLevel: "AREA_ONLY",
      latencySeconds: 900,
      eventTime: iso(now, -200),
      effects: [{ kind: "ADVISORY" }],
    }),
    scenarioEvent(ws, now, {
      id: "ev-news-581",
      type: "NEWS_REPORT",
      category: "NEWS",
      sourceId: "social-sim",
      sourceName: "Unverified social media post (simulated)",
      sourceType: "NEWS",
      authorityLevel: "UNVERIFIED_OPEN_SOURCE",
      title: "Unconfirmed post: “I-581 shut down at Elm Ave?”",
      roadName: "I-581",
      geometry: point(SCENARIO_PLACES.camera581.lat, SCENARIO_PLACES.camera581.lng),
      eventTime: iso(now, -35),
      effects: [{ kind: "BLOCKS_ROAD", radiusM: 150 }],
    }),
  ];
}

export function baselineCameras(ws: string, now: Date): CameraResource[] {
  return [
    {
      id: "cam-vdot-419-keagy",
      workspaceId: ws,
      mode: "SCENARIO",
      simulated: true,
      name: "VDOT camera — Rte 419 (Electric Rd) south of Keagy Rd",
      sourceType: "PUBLIC_TRAFFIC_CAMERA",
      provider: "VDOT (simulated feed)",
      location: SCENARIO_PLACES.camera419,
      status: "ONLINE",
      snapshotUrl: "/sim/camera-419-clear.svg",
      accessLog: [],
    },
    {
      id: "cam-vdot-581-elm",
      workspaceId: ws,
      mode: "SCENARIO",
      simulated: true,
      name: "VDOT camera — I-581 @ Elm Ave",
      sourceType: "PUBLIC_TRAFFIC_CAMERA",
      provider: "VDOT (simulated feed)",
      location: SCENARIO_PLACES.camera581,
      status: "ONLINE",
      snapshotUrl: "/sim/camera-581-flowing.svg",
      accessLog: [],
    },
    {
      id: "cam-ring-walker",
      workspaceId: ws,
      mode: "SCENARIO",
      simulated: true,
      name: "Front-door camera (resident opt-in)",
      sourceType: "USER_AUTHORIZED_RING_CAMERA",
      provider: "Ring — simulated opt-in (no Ring API connection)",
      location: SCENARIO_PLACES.ringWalker,
      status: "ONLINE",
      consent: {
        ownerLabel: "Denise Walker (resident)",
        scope: "CURRENT_SNAPSHOT",
        grantedAt: iso(now, -60 * 20),
        expiresAt: iso(now, 60 * 48),
        purpose: "Let coordinators confirm driveway access at this address during storm response. One snapshot per request; no live view, no recording.",
      },
      accessLog: [{ at: iso(now, -60 * 20), action: "Consent granted: current snapshot on request, 72 h", by: "Denise Walker (resident)" }],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Scenario injections (demo controls)                                  */
/* ------------------------------------------------------------------ */

export const INJECTIONS = [
  "camera-obstruction",
  "collision-closure",
  "tornado-warning",
  "severe-thunderstorm",
  "community-flood-report",
  "unverified-news",
  "clear-crash",
  "end-warnings",
] as const;
export type Injection = (typeof INJECTIONS)[number];

export const INJECTION_LABELS: Record<Injection, { label: string; detail: string }> = {
  "camera-obstruction": { label: "Traffic camera flags obstruction", detail: "Machine-derived observation from a VDOT camera on Rte 419. Alone it is never actionable." },
  "collision-closure": { label: "VDOT reports crash closing Rte 419", detail: "Authoritative operational data: Rte 419 closed between Keagy Rd and Brambleton Ave." },
  "tornado-warning": { label: "NWS tornado warning (SE Roanoke)", detail: "Authoritative alert polygon over Southeast Roanoke / Garden City / Riverdale, 25 minutes." },
  "severe-thunderstorm": { label: "NWS severe thunderstorm warning (Salem / Cave Spring)", detail: "Holds outdoor saw, ladder and roof work inside the polygon." },
  "community-flood-report": { label: "Resident reports water over Colonial Ave", detail: "One community report. A second independent report corroborates it." },
  "unverified-news": { label: "Unverified social post about a bridge", detail: "Open-source item. Shown for review; can never change a route on its own." },
  "clear-crash": { label: "VDOT: Rte 419 reopened", detail: "The crash and the camera observation are cleared." },
  "end-warnings": { label: "NWS: warnings expired", detail: "Tornado and thunderstorm warnings end. Held missions become resumable by a coordinator." },
};

/** Events to add for an injection. `seq` keeps ids unique; community reports get a distinct reporter per call. */
export function injectionEvents(kind: Injection, ws: string, now: Date, seq: string): OperationalEvent[] {
  switch (kind) {
    case "camera-obstruction":
      return [
        scenarioEvent(ws, now, {
          id: `ev-cam419-${seq}`,
          type: "CAMERA_OBSERVATION",
          category: "CAMERA",
          sourceId: "cam-vdot-419-keagy",
          sourceName: "VDOT camera — Rte 419 south of Keagy Rd (AI observation)",
          sourceType: "PUBLIC_CAMERA",
          authorityLevel: "MACHINE_DERIVED_OBSERVATION",
          title: "Camera AI: possible obstruction on Rte 419",
          roadName: "Rte 419 (Electric Rd)",
          geometry: point(SCENARIO_PLACES.camera419.lat, SCENARIO_PLACES.camera419.lng),
          eventTime: now.toISOString(),
          confidence: 0.71,
          effects: [{ kind: "BLOCKS_ROAD", radiusM: 150 }],
          camera: {
            cameraId: "cam-vdot-419-keagy",
            cameraName: "VDOT camera — Rte 419 south of Keagy Rd",
            observationType: "ROAD_BLOCKED",
            machineGenerated: true,
            humanVerified: false,
            mediaReference: "/sim/camera-419-blocked.svg",
          },
        }),
      ];
    case "collision-closure":
      return [
        scenarioEvent(ws, now, {
          id: `ev-511-crash419-${seq}`,
          type: "TRAFFIC_CRASH",
          category: "TRAFFIC",
          sourceId: "va511-sim",
          sourceName: "Virginia 511 / VDOT (simulated feed)",
          sourceType: "VIRGINIA_511",
          authorityLevel: "AUTHORITATIVE_OPERATIONAL_DATA",
          title: "Crash — Rte 419 closed between Keagy Rd and Brambleton Ave",
          roadName: "Rte 419 (Electric Rd)",
          geometry: point(SCENARIO_PLACES.crash419.lat, SCENARIO_PLACES.crash419.lng),
          severity: "MODERATE",
          eventTime: now.toISOString(),
          expiresAt: iso(now, 90),
          effects: [{ kind: "BLOCKS_ROAD", radiusM: 150 }],
        }),
      ];
    case "tornado-warning": {
      const common = {
        type: "TORNADO_WARNING" as const,
        category: "ALERT" as const,
        authorityLevel: "AUTHORITATIVE_ALERT" as const,
        title: "Tornado Warning — Southeast Roanoke, Garden City, Riverdale",
        description: "SIMULATED ALERT. Take shelter now in an interior room on the lowest floor.",
        geometry: TORNADO_AREA,
        severity: "EXTREME" as const,
        urgency: "Immediate",
        certainty: "Observed",
        startsAt: now.toISOString(),
        expiresAt: iso(now, 25),
        effects: [{ kind: "HOLD_ALL_ACTIVITY" } as OperationalEffect],
      };
      return [
        scenarioEvent(ws, now, { ...common, id: `ev-nws-tor-${seq}`, sourceId: "nws-sim", sourceName: "National Weather Service (simulated alert)", sourceType: "NWS" }),
        scenarioEvent(ws, now, { ...common, id: `ev-ipaws-tor-${seq}`, sourceId: "ipaws-sim", sourceName: "IPAWS-OPEN (simulated copy of the NWS alert)", sourceType: "IPAWS" }),
      ];
    }
    case "severe-thunderstorm":
      return [
        scenarioEvent(ws, now, {
          id: `ev-nws-svr-${seq}`,
          type: "SEVERE_THUNDERSTORM_WARNING",
          category: "ALERT",
          sourceId: "nws-sim",
          sourceName: "National Weather Service (simulated alert)",
          sourceType: "NWS",
          authorityLevel: "AUTHORITATIVE_ALERT",
          title: "Severe Thunderstorm Warning — Salem, Cave Spring",
          description: "SIMULATED ALERT. 60 mph wind gusts. Stay away from trees.",
          geometry: TSTORM_AREA,
          severity: "SEVERE",
          startsAt: now.toISOString(),
          expiresAt: iso(now, 40),
          effects: [{ kind: "HOLD_OUTDOOR_WORK" }],
        }),
      ];
    case "community-flood-report":
      return [
        scenarioEvent(ws, now, {
          id: `ev-com-colonial-${seq}`,
          type: "FLOODING",
          category: "COMMUNITY",
          sourceId: `resident-report-${seq}`,
          sourceName: "Resident report (CoORDINATE app)",
          sourceType: "COMMUNITY",
          authorityLevel: "COMMUNITY_REPORT",
          title: "Resident report: water over Colonial Ave near Cave Spring Ln",
          roadName: "Colonial Ave",
          geometry: point(SCENARIO_PLACES.colonialFlood.lat, SCENARIO_PLACES.colonialFlood.lng),
          eventTime: now.toISOString(),
          effects: [{ kind: "BLOCKS_ROAD", radiusM: 120 }],
        }),
      ];
    case "unverified-news":
      return [
        scenarioEvent(ws, now, {
          id: `ev-news-bridge-${seq}`,
          type: "NEWS_REPORT",
          category: "NEWS",
          sourceId: "social-sim",
          sourceName: "Unverified social media post (simulated)",
          sourceType: "NEWS",
          authorityLevel: "UNVERIFIED_OPEN_SOURCE",
          title: "Unconfirmed post: “Brambleton Ave bridge washed out”",
          roadName: "Brambleton Ave",
          geometry: point(37.2525, -79.992),
          eventTime: now.toISOString(),
          effects: [{ kind: "BLOCKS_ROAD", radiusM: 150 }],
        }),
      ];
    case "clear-crash":
    case "end-warnings":
      return [];
  }
}

/** Event ids an injection expires (set expiresAt = now). */
export function injectionExpires(kind: Injection, events: OperationalEvent[]): string[] {
  if (kind === "clear-crash") return events.filter((e) => e.id.startsWith("ev-511-crash419-") || e.id.startsWith("ev-cam419-")).map((e) => e.id);
  if (kind === "end-warnings") return events.filter((e) => e.type === "TORNADO_WARNING" || e.type === "SEVERE_THUNDERSTORM_WARNING").map((e) => e.id);
  return [];
}

/* ------------------------------------------------------------------ */
/* Community reports from information-only intake (rule R-I01)          */
/* ------------------------------------------------------------------ */

/**
 * An information-only resident report becomes an UNVERIFIED community-report
 * event. Its proposed effect only becomes actionable when corroborated.
 */
export function communityReportFromIncident(incident: Incident, mode: "LIVE" | "SCENARIO"): OperationalEvent {
  const text = incident.request.text;
  const flooded = /\b(?:flood\w*|under ?water|water (?:is )?(?:over|across)|standing water|high water|washed out)\b/i.test(text);
  const partial = /\b(?:one lane|single lane|partially|part of the road)\b/i.test(text);
  const road = /\b(?:on|across|of|along)\s+((?:[A-Z][a-z]+\s){1,3}(?:Rd|Road|St|Street|Ave|Avenue|Ln|Lane|Dr|Drive|Blvd|Pkwy|Hwy))\b/.exec(text)?.[1];
  const effect: OperationalEffect = partial ? { kind: "SLOWS_ROAD", radiusM: 120, delayMinutes: 5 } : { kind: "BLOCKS_ROAD", radiusM: 120 };
  return {
    id: `ev-report-${incident.id}`,
    workspaceId: incident.workspaceId,
    mode,
    simulated: mode === "SCENARIO",
    type: flooded ? "FLOODING" : "ROAD_HAZARD",
    category: "COMMUNITY",
    // Independence (rule A2) is per reporter; reports without a known reporter count as ONE source together.
    sourceId: incident.request.reporterId ?? "anonymous-reporter",
    sourceName: `Resident report ${incident.number} (CoORDINATE app)`,
    sourceType: "COMMUNITY",
    authorityLevel: "COMMUNITY_REPORT",
    verificationStatus: "UNVERIFIED",
    title: `Resident report: ${flooded ? "water over the road" : partial ? "lane partly blocked" : "road blocked"}${road ? ` — ${road}` : ""}`,
    description: text.slice(0, 280),
    roadName: road,
    geometry: point(incident.location.lat, incident.location.lng),
    eventTime: incident.createdAt,
    fetchedAt: incident.createdAt,
    effects: [effect],
    incidentId: incident.id,
  };
}
