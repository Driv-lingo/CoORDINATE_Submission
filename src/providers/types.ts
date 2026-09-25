import type { CameraResource, OperationalEffect, OperationalEvent, OperationalEventType, ProviderHealth, Severity } from "@/domain/ops";

/**
 * A live data source. Providers only READ public or partner feeds and turn
 * them into OperationalEvents; they never write to any external system.
 */
export interface LiveProvider {
  id: string;
  name: string;
  category: ProviderHealth["category"];
  /** 1 = public feed usable now, 2 = requires access/partnership, 3 = simulated only. */
  tier: 1 | 2 | 3;
  /** Normal freshness of the upstream data once connected. */
  liveState: "LIVE" | "LIVE_DELAYED";
  pollSeconds: number;
  /** Why the provider cannot run in this deployment, or null when it can. */
  unavailable(): { state: "NOT_CONFIGURED" | "PARTNER_REQUIRED"; detail: string } | null;
  fetchEvents?(now: Date): Promise<OperationalEvent[]>;
  fetchCameras?(now: Date): Promise<CameraResource[]>;
  /** One-line description of what the source is authoritative for. */
  describes: string;
}

export { LIVE_WS } from "@/data/mode";
import { LIVE_WS } from "@/data/mode";

/** Operation bounding box [minLng, minLat, maxLng, maxLat]; default Roanoke Valley. */
export function operationBbox(): [number, number, number, number] {
  const raw = process.env.COORDINATE_OPERATION_BBOX;
  const parts = raw?.split(",").map(Number);
  if (parts && parts.length === 4 && parts.every(Number.isFinite)) return parts as [number, number, number, number];
  return [-80.25, 37.1, -79.75, 37.45];
}

export function inBbox(lng: number, lat: number, b = operationBbox()): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

/**
 * Normalize one feed item: fixes the live workspace/mode, and attaches provenance
 * (source, upstream id and URL, timestamps, hash of the raw payload) plus the raw
 * payload itself for audit.
 */
export function liveEvent(
  e: Omit<OperationalEvent, "workspaceId" | "mode" | "simulated" | "provenance" | "raw">,
  meta: { raw?: unknown; sourceUrl?: string; sourceUpdatedAt?: string } = {},
): OperationalEvent {
  if (!isValidGeometry(e.geometry)) throw new Error(`invalid geometry in ${e.id}`);
  const raw = meta.raw ?? null;
  return {
    ...e,
    workspaceId: LIVE_WS,
    mode: "LIVE",
    simulated: false,
    provenance: {
      source: e.sourceId,
      sourceId: e.originalId ?? e.id,
      sourceUrl: meta.sourceUrl && /^https:\/\//.test(meta.sourceUrl) ? meta.sourceUrl : undefined,
      sourceUpdatedAt: meta.sourceUpdatedAt ?? e.eventTime,
      ingestedAt: e.fetchedAt,
      observedAt: e.fetchedAt,
      expiresAt: e.expiresAt,
      rawHash: rawHash(raw ?? { ...e, fetchedAt: undefined }),
      status: "active",
    },
    raw: boundedRaw(raw),
  };
}

/** Stable sha256 of a payload (object keys sorted). */
export function rawHash(v: unknown): string {
  const stable = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(stable) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, stable((x as Record<string, unknown>)[k])])) : x;
  return createHash("sha256").update(JSON.stringify(stable(v)) ?? "null").digest("hex");
}

/** Keep the audit copy, but cap it so one huge item can't bloat storage. */
function boundedRaw(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return text.length <= 32_000 ? raw : { truncated: true, excerpt: text.slice(0, 32_000) };
}

/** Untrusted feed collections: anything that is not an array is treated as empty. */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  const res = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}

/* ------------------------------------------------------------------ */
/* Alert vocabulary shared by NWS and IPAWS (CAP) parsers               */
/* ------------------------------------------------------------------ */

export function alertType(event: string): { type: OperationalEventType; effects: OperationalEffect[] } {
  const e = event.toLowerCase();
  if (/tornado warning/.test(e)) return { type: "TORNADO_WARNING", effects: [{ kind: "HOLD_ALL_ACTIVITY" }] };
  if (/severe thunderstorm warning/.test(e)) return { type: "SEVERE_THUNDERSTORM_WARNING", effects: [{ kind: "HOLD_OUTDOOR_WORK" }] };
  if (/(?:extreme|high) wind warning/.test(e)) return { type: "HIGH_WIND", effects: [{ kind: "HOLD_OUTDOOR_WORK" }] };
  if (/flash flood (?:warning|emergency)/.test(e)) return { type: "FLASH_FLOOD_WARNING", effects: [{ kind: "ADVISORY" }] };
  if (/evacuation/.test(e)) return { type: "EVACUATION", effects: [{ kind: "NO_CIVILIAN_ENTRY" }] };
  if (/shelter in place/.test(e)) return { type: "SHELTER_IN_PLACE", effects: [{ kind: "HOLD_ALL_ACTIVITY" }] };
  if (/hazardous materials|nuclear power plant|radiological/.test(e)) return { type: "HAZMAT", effects: [{ kind: "NO_CIVILIAN_ENTRY" }] };
  if (/fire warning/.test(e)) return { type: "FIRE", effects: [{ kind: "NO_CIVILIAN_ENTRY" }] };
  return { type: "WEATHER_ADVISORY", effects: [{ kind: "ADVISORY" }] };
}

export function capSeverity(s: unknown): Severity {
  const v = String(s ?? "").toUpperCase();
  return v === "EXTREME" || v === "SEVERE" || v === "MODERATE" || v === "MINOR" ? v : "UNKNOWN";
}

import { createHash } from "node:crypto";
import { isValidGeometry } from "@/engine/geometry";
export { isValidGeometry, mergePolygons } from "@/engine/geometry";

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
export const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
export const isoOrUndef = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};
/** First defined value among candidate keys (case-insensitive). */
export function pick(obj: Record<string, unknown> | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined;
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined && obj[real] !== undefined && obj[real] !== null && obj[real] !== "") return obj[real];
  }
  return undefined;
}
