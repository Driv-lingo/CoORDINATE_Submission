import { getRepository } from "@/data";
import type { CameraResource, OperationalEvent, ProviderHealth, ProviderState } from "@/domain/ops";
import { ingestSnapshot, isCurrent, type IngestResult } from "@/live/ingest";
import { publishChange } from "@/realtime/pubsub";
import { azureTrafficProvider } from "./azureTraffic";
import { ipawsProvider } from "./ipaws";
import { newsProvider } from "./news";
import { nwsProvider } from "./nws";
import { agencyCadProvider, pulsePointPartnerProvider, ringProvider } from "./partner";
import { publicCadProvider } from "./publicCad";
import { LIVE_WS, type LiveProvider } from "./types";
import { va511Provider, vdotCameraProvider } from "./va511";

/**
 * Live provider registry.
 *
 * Each successful fetch goes through the ingest pipeline (src/live/ingest.ts): validation,
 * deduplication by source + sourceId, and an upsert into the "live" workspace of the
 * repository (Cosmos DB when configured). Changes are pushed to /live viewers over Web PubSub.
 * Feeds are polled by the server-side loop (src/instrumentation.ts) and, as a fallback, when
 * a live view is read. Health is DERIVED from what actually happened on the last attempts —
 * nothing is labelled LIVE unless data was fetched successfully and recently.
 */

export const PROVIDERS: LiveProvider[] = [
  nwsProvider,
  azureTrafficProvider,
  va511Provider,
  vdotCameraProvider,
  publicCadProvider,
  newsProvider,
  ipawsProvider,
  ringProvider,
  pulsePointPartnerProvider,
  agencyCadProvider,
];

interface CacheEntry {
  /** Number of items in the last successful fetch. */
  count: number;
  lastIngest?: IngestResult;
  cameras: CameraResource[];
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  inflight?: Promise<void>;
}

const g = globalThis as unknown as { __coordinateLive?: Map<string, CacheEntry> };
const cache = (g.__coordinateLive ??= new Map());
const entry = (id: string): CacheEntry => {
  let e = cache.get(id);
  if (!e) cache.set(id, (e = { count: 0, cameras: [] }));
  return e;
};

const MAX_EVENTS_PER_PROVIDER = 400;

async function refresh(p: LiveProvider, now: Date): Promise<void> {
  const e = entry(p.id);
  e.lastAttemptAt = Date.now();
  try {
    let changed = false;
    if (p.fetchEvents) {
      const events = (await p.fetchEvents(now)).slice(0, MAX_EVENTS_PER_PROVIDER);
      const repo = getRepository();
      await repo.ensureWorkspace(LIVE_WS);
      e.lastIngest = await ingestSnapshot(repo, p.id, events, now);
      e.count = events.length - e.lastIngest.rejected.length;
      changed = e.lastIngest.changed;
    }
    if (p.fetchCameras) {
      const before = e.cameras.map((c) => c.id).join();
      e.cameras = await p.fetchCameras(now);
      e.count = e.cameras.length;
      changed ||= before !== e.cameras.map((c) => c.id).join();
    }
    e.lastSuccessAt = Date.now();
    e.lastError = undefined;
    if (changed) void publishChange(LIVE_WS, `live.${p.id}`);
  } catch (err) {
    e.lastError = ((err as Error).message || String(err)).slice(0, 200);
  }
}

function due(p: LiveProvider): boolean {
  if (p.unavailable()) return false;
  const e = entry(p.id);
  if (e.inflight) return false;
  const last = e.lastAttemptAt ?? 0;
  // Back off after failures so a blocked network is not hammered.
  const interval = (e.lastError ? Math.max(p.pollSeconds, 300) : p.pollSeconds) * 1000;
  return Date.now() - last >= interval;
}

/** Kick off refreshes that are due; optionally wait up to `waitMs` for them. */
export async function refreshDue(now: Date, waitMs = 0): Promise<void> {
  const started: Promise<void>[] = [];
  for (const p of PROVIDERS) {
    if (!due(p)) continue;
    const e = entry(p.id);
    e.inflight = refresh(p, now).finally(() => {
      e.inflight = undefined;
    });
    started.push(e.inflight);
  }
  const pending = [...PROVIDERS.map((p) => entry(p.id).inflight).filter(Boolean)] as Promise<void>[];
  if (waitMs > 0 && pending.length) await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, waitMs))]);
  void started;
}

/**
 * Current live items from the repository: active in their source, not expired, from a
 * provider that is still enabled. Raw payloads stay in storage for audit and are stripped here.
 * Stale data is returned with its source's health so callers can label it — never as current.
 */
export async function liveEvents(now: Date, waitMs = 0): Promise<OperationalEvent[]> {
  await refreshDue(now, waitMs);
  const enabled = new Set(PROVIDERS.filter((p) => !p.unavailable()).map((p) => p.id));
  const repo = getRepository();
  await repo.ensureWorkspace(LIVE_WS);
  return (await repo.listEvents(LIVE_WS))
    .filter((e) => !e.simulated && e.provenance && enabled.has(e.provenance.source) && isCurrent(e, now))
    .map(({ raw: _raw, ...e }) => { // eslint-disable-line @typescript-eslint/no-unused-vars
      // Active items were listed by the source's last successful fetch: they are as fresh as it is.
      // After a restart, before the first poll, that is the stored observation time (so old data reads as stale).
      const last = entry(e.provenance!.source).lastSuccessAt;
      return { ...e, fetchedAt: last ? new Date(last).toISOString() : e.provenance!.observedAt };
    });
}

/** Test hook: forget polling state (not the stored events). */
export function resetLiveRegistry() {
  cache.clear();
}

export async function liveCameras(now: Date, waitMs = 0): Promise<CameraResource[]> {
  await refreshDue(now, waitMs);
  return PROVIDERS.flatMap((p) => (p.unavailable() ? [] : entry(p.id).cameras));
}

export function liveProviderHealth(now = new Date()): (ProviderHealth & { tier: 1 | 2 | 3; describes: string })[] {
  return PROVIDERS.map((p) => {
    const base = { id: p.id, name: p.name, category: p.category, tier: p.tier, describes: p.describes };
    const blocked = p.unavailable();
    if (blocked) return { ...base, state: blocked.state, detail: blocked.detail };
    const e = entry(p.id);
    const count = e.count;
    const ago = (t?: number) => (t ? Math.round((now.getTime() - t) / 1000) : undefined);
    let state: ProviderState;
    let detail: string;
    if (!e.lastAttemptAt) {
      state = "PENDING";
      detail = "Configured — not polled yet in this process (polled while a live view is open).";
    } else if (!e.lastSuccessAt) {
      state = "OFFLINE";
      detail = `No successful fetch yet: ${e.lastError ?? "unknown error"}`;
    } else if (e.lastError) {
      state = "DEGRADED";
      detail = `Last fetch failed (${e.lastError}); showing data from ${ago(e.lastSuccessAt)} s ago.`;
    } else if (now.getTime() - e.lastSuccessAt > p.pollSeconds * 3000) {
      state = "STALE";
      detail = `Last successful fetch ${ago(e.lastSuccessAt)} s ago.`;
    } else {
      state = p.liveState;
      detail = `${count} item(s)${p.liveState === "LIVE_DELAYED" ? " · source is delayed by design" : ""}.`;
    }
    return {
      ...base,
      state,
      detail,
      itemCount: count,
      lastAttemptAt: e.lastAttemptAt ? new Date(e.lastAttemptAt).toISOString() : undefined,
      lastSuccessAt: e.lastSuccessAt ? new Date(e.lastSuccessAt).toISOString() : undefined,
      lastError: e.lastError,
    };
  });
}

/**
 * Live readiness: configured event feeds that have not delivered data within
 * max(3 poll intervals, 15 min). Missing data must never be read as "clear".
 */
export function liveReadiness(now = new Date()): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const p of PROVIDERS) {
    if (!p.fetchEvents || p.unavailable()) continue;
    const e = entry(p.id);
    const fresh = e.lastSuccessAt && now.getTime() - e.lastSuccessAt <= Math.max(p.pollSeconds * 3, 900) * 1000;
    if (!fresh) missing.push(p.name);
  }
  return { complete: missing.length === 0, missing };
}
