import type { OperationalEvent } from "@/domain/ops";
import { isValidGeometry } from "@/engine/geometry";
import type { Repository } from "@/data/repository";
import { LIVE_WS } from "@/providers/types";

/**
 * Live ingest pipeline, after a source adapter has parsed and normalized a feed:
 *
 *   validate → deduplicate (source + sourceId) → upsert into the repository
 *   (Cosmos DB when configured) → report what changed (the caller publishes to Web PubSub)
 *
 * Every feed CoORDINATE reads is a snapshot of what is active now, so an item the
 * source stops listing is marked "cleared", not deleted: the record and its raw payload
 * stay for audit. Nothing here invents, merges or upgrades facts; an item is stored
 * exactly as the source described it, with its provenance.
 */

export interface IngestResult {
  source: string;
  received: number;
  rejected: { id: string; reason: string }[];
  inserted: number;
  updated: number;
  unchanged: number;
  cleared: number;
  /** True when anything a viewer would see changed. */
  changed: boolean;
}

/** Unchanged items are re-written (observedAt) at most this often, to keep database writes low. */
const OBSERVED_WRITE_INTERVAL_MS = 15 * 60e3;

/** Keep cleared items for audit this long before they are pruned. */
export const CLEARED_RETENTION_MS = 24 * 3600e3;

/** Cosmos-safe, deterministic document id for a source item. */
export function liveDocId(source: string, sourceId: string): string {
  const safe = sourceId.replace(/[^A-Za-z0-9._:-]+/g, "_");
  if (`${source}-${safe}`.length <= 200) return `${source}-${safe}`;
  let h = 2166136261;
  for (let i = 0; i < sourceId.length; i++) h = Math.imul(h ^ sourceId.charCodeAt(i), 16777619);
  return `${source}-${safe.slice(0, 150)}-${(h >>> 0).toString(36)}`;
}

/** Validation: the canonical fields every stored live event must have. */
export function validateLiveEvent(e: OperationalEvent): string | null {
  if (e.simulated || e.mode !== "LIVE") return "not a live item";
  if (!e.provenance?.source || !e.provenance.sourceId) return "missing provenance";
  if (!e.provenance.rawHash) return "missing raw hash";
  if (!e.title?.trim()) return "missing title";
  if (!isValidGeometry(e.geometry)) return "invalid geometry";
  if (Number.isNaN(Date.parse(e.fetchedAt))) return "invalid fetch time";
  return null;
}

/** Deduplicate one batch by source + sourceId; the most recently updated copy wins. */
export function dedupe(events: OperationalEvent[]): OperationalEvent[] {
  const byKey = new Map<string, OperationalEvent>();
  const t = (e: OperationalEvent) => Date.parse(e.provenance?.sourceUpdatedAt ?? "") || 0;
  for (const e of events) {
    const key = `${e.provenance!.source}\u0000${e.provenance!.sourceId}`;
    const prev = byKey.get(key);
    if (!prev || t(e) >= t(prev)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

/**
 * Upsert one successful fetch of `source` into the live workspace.
 * `events` must be everything the source currently lists (a snapshot).
 */
export async function ingestSnapshot(repo: Repository, source: string, events: OperationalEvent[], now: Date): Promise<IngestResult> {
  const at = now.toISOString();
  const rejected: IngestResult["rejected"] = [];
  const valid: OperationalEvent[] = [];
  for (const raw of events) {
    const e: OperationalEvent = raw.provenance ? { ...raw, provenance: { ...raw.provenance, source } } : raw;
    const reason = validateLiveEvent(e);
    if (reason) rejected.push({ id: e.id, reason });
    else valid.push(e);
  }
  const incoming = dedupe(valid);

  const existing = (await repo.listEvents(LIVE_WS)).filter((e) => e.provenance?.source === source);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const writes: OperationalEvent[] = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seen = new Set<string>();

  for (const e of incoming) {
    const id = liveDocId(source, e.provenance!.sourceId);
    seen.add(id);
    const prev = byId.get(id);
    const doc: OperationalEvent = { ...e, id, workspaceId: LIVE_WS };
    if (!prev) {
      inserted++;
      writes.push({ ...doc, provenance: { ...e.provenance!, ingestedAt: at, observedAt: at, status: "active" } });
    } else if (prev.provenance?.rawHash !== e.provenance!.rawHash || prev.provenance?.status !== "active") {
      updated++;
      // The upstream item changed: replace it, keeping any coordinator review of it.
      writes.push({ ...doc, coordinatorReview: prev.coordinatorReview, provenance: { ...e.provenance!, ingestedAt: at, observedAt: at, status: "active" } });
    } else {
      unchanged++;
      // Same payload: freshness comes from the source's last successful fetch, so the stored
      // copy is only touched now and then to record that the source still lists it.
      if (now.getTime() - Date.parse(prev.provenance!.observedAt) > OBSERVED_WRITE_INTERVAL_MS) {
        writes.push({ ...prev, fetchedAt: e.fetchedAt, provenance: { ...prev.provenance!, observedAt: at } });
      }
    }
  }

  let cleared = 0;
  const prune: string[] = [];
  for (const prev of existing) {
    if (seen.has(prev.id)) continue;
    if (prev.provenance?.status === "active") {
      cleared++;
      writes.push({ ...prev, provenance: { ...prev.provenance, status: "cleared", clearedAt: at } });
    } else if (prev.provenance?.clearedAt && now.getTime() - Date.parse(prev.provenance.clearedAt) > CLEARED_RETENTION_MS) {
      prune.push(prev.id);
    }
  }

  if (writes.length) await repo.saveEvents(writes);
  if (prune.length && repo.deleteEvents) await repo.deleteEvents(LIVE_WS, prune);
  return { source, received: events.length, rejected, inserted, updated, unchanged, cleared, changed: inserted + updated + cleared > 0 };
}

/** Items a viewer should see: active in their source and not past their own expiry. */
export function isCurrent(e: OperationalEvent, now: Date): boolean {
  if (e.provenance && e.provenance.status !== "active") return false;
  return !e.expiresAt || Date.parse(e.expiresAt) > now.getTime();
}
