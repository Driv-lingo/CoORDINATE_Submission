"use client";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clock,
  Database,
  Eye,
  HelpCircle,
  Lock,
  PauseCircle,
  PlayCircle,
  Radio,
  Route,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { MissionStatusBadge } from "@/components/badges";
import type { MapMarker, MapShape } from "@/components/Map";
import { Button, Callout, Pill } from "@/components/ui";
import type { CameraView, ClusterView, IncidentDetail, IncidentSummary, OpsMissionView, OpsView, ProviderRow } from "@/domain/dto";
import type { AuthorityLevel, DecisionRecord, EvidenceItem, OperationalEventType, ProviderState, RoutePlan, VerificationStatus } from "@/domain/ops";
import { api, ApiError, notifyChanged } from "@/lib/api";
import { clock, cn, timeAgo } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Vocabulary → presentation                                           */
/* ------------------------------------------------------------------ */

export const AUTHORITY_LABELS: Record<AuthorityLevel, { label: string; cls: string }> = {
  AUTHORITATIVE_ALERT: { label: "Official alert", cls: "bg-ink text-white" },
  AUTHORITATIVE_OPERATIONAL_DATA: { label: "Official operational data", cls: "bg-slate-700 text-white" },
  VERIFIED_PARTNER: { label: "Verified partner", cls: "bg-active text-white" },
  COORDINATOR_CONFIRMED: { label: "Coordinator-confirmed", cls: "bg-done text-white" },
  COMMUNITY_REPORT: { label: "Community report", cls: "bg-general-soft text-general ring-1 ring-general/30" },
  MEDIA_REPORT: { label: "Media report", cls: "bg-slate-100 text-slate-700 ring-1 ring-slate-300" },
  MACHINE_DERIVED_OBSERVATION: { label: "Camera AI observation", cls: "bg-forming-soft text-forming ring-1 ring-forming/30" },
  UNVERIFIED_OPEN_SOURCE: { label: "Unverified open source", cls: "bg-slate-100 text-slate-600 ring-1 ring-slate-300" },
};

const VERIFICATION_STYLE: Record<VerificationStatus, { label: string; cls: string }> = {
  AUTHORITATIVE: { label: "Authoritative", cls: "bg-ink text-white" },
  VERIFIED: { label: "Verified", cls: "bg-done text-white" },
  CORROBORATED: { label: "Corroborated", cls: "bg-done-soft text-done ring-1 ring-done/30" },
  UNVERIFIED: { label: "Unverified — review", cls: "bg-trained-soft text-trained ring-1 ring-trained/30" },
  DISPUTED: { label: "Disputed", cls: "bg-slate-200 text-slate-700" },
  STALE: { label: "Stale", cls: "bg-slate-100 text-slate-500" },
};

export const PROVIDER_STATE_STYLE: Record<ProviderState, { label: string; cls: string; dot: string }> = {
  LIVE: { label: "Live", cls: "bg-done-soft text-done", dot: "bg-done" },
  LIVE_DELAYED: { label: "Live (delayed)", cls: "bg-done-soft text-done", dot: "bg-done" },
  CONNECTED: { label: "Connected", cls: "bg-done-soft text-done", dot: "bg-done" },
  SIMULATED: { label: "Simulated", cls: "bg-forming-soft text-forming", dot: "bg-forming" },
  STALE: { label: "Stale", cls: "bg-trained-soft text-trained", dot: "bg-trained" },
  DEGRADED: { label: "Degraded", cls: "bg-trained-soft text-trained", dot: "bg-trained" },
  OFFLINE: { label: "Offline", cls: "bg-life-soft text-life", dot: "bg-life" },
  NOT_CONFIGURED: { label: "Not configured", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  PARTNER_REQUIRED: { label: "Partner access required", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  PENDING: { label: "Not polled yet", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

const TYPE_COLOR: Partial<Record<OperationalEventType, string>> = {
  TORNADO_WARNING: "#b42318",
  SEVERE_THUNDERSTORM_WARNING: "#c2410c",
  HIGH_WIND: "#c2410c",
  FLASH_FLOOD_WARNING: "#1d4ed8",
  EVACUATION: "#7e22ce",
  SHELTER_IN_PLACE: "#7e22ce",
  HAZMAT: "#7e22ce",
  FIRE: "#b42318",
  WEATHER_ADVISORY: "#64748b",
};

const EFFECT_TEXT: Record<string, string> = {
  BLOCKS_ROAD: "blocks the road",
  SLOWS_ROAD: "slows traffic",
  HOLD_ALL_ACTIVITY: "holds all activity",
  HOLD_OUTDOOR_WORK: "holds outdoor work",
  AVOID_AREA: "routes avoid the area",
  NO_CIVILIAN_ENTRY: "no civilian entry",
  ADVISORY: "awareness only",
};

export function SimBadge() {
  return <Pill className="bg-forming text-white" title="Simulated for the fictional exercise — not a real alert or feed">SIMULATED</Pill>;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const v = VERIFICATION_STYLE[status];
  return <Pill className={v.cls}>{v.label}</Pill>;
}

/* ------------------------------------------------------------------ */
/* Map layers                                                          */
/* ------------------------------------------------------------------ */

export interface OpsLayers {
  hazards: boolean;
  unverified: boolean;
  routes: boolean;
  cameras: boolean;
}

export function opsMapLayers(view: OpsView | null, layers: OpsLayers, focus?: { clusterId?: string; missionId?: string }): { shapes: MapShape[]; markers: MapMarker[] } {
  if (!view) return { shapes: [], markers: [] };
  const shapes: MapShape[] = [];
  if (layers.hazards || layers.unverified) {
    for (const c of view.clusters) {
      const actionable = c.actionableEffects.some((e) => e.kind !== "ADVISORY");
      // Official/corroborated items (even advisory-only ones) are "official"; everything else is drawn dashed as unverified.
      const official = c.status === "AUTHORITATIVE" || c.status === "CORROBORATED" || c.status === "VERIFIED";
      if (c.stale) continue;
      if (!official && !layers.unverified) continue;
      if (official && !layers.hazards) continue;
      const effect = c.actionableEffects[0]?.kind ?? c.pendingEffects[0]?.effect.kind ?? "ADVISORY";
      const area = c.geometry.type === "Polygon" || c.geometry.type === "MultiPolygon";
      const color = TYPE_COLOR[c.type] ?? (effect === "BLOCKS_ROAD" && actionable ? "#b42318" : effect === "SLOWS_ROAD" ? "#a15c07" : "#64748b");
      shapes.push({
        id: `cl:${c.id}`,
        geometry: c.geometry,
        color: official ? color : "#64748b",
        dashed: !official,
        fillOpacity: area ? (c.id === focus?.clusterId ? 0.28 : c.type === "WEATHER_ADVISORY" || c.type === "FLASH_FLOOD_WARNING" ? 0.06 : 0.14) : actionable ? 0.35 : 0.12,
        weight: c.id === focus?.clusterId ? 4 : area ? 2 : 2,
        radiusM: c.actionableEffects[0]?.radiusM ?? c.pendingEffects[0]?.effect.radiusM ?? 120,
        label: `${c.title} — ${VERIFICATION_STYLE[c.status].label}${actionable ? ` · ${EFFECT_TEXT[effect]}` : c.pendingEffects.length ? " · awaiting corroboration (no effect on routes)" : ""}${c.simulated ? " · SIMULATED" : ""}`,
      });
    }
  }
  if (layers.routes) {
    for (const m of view.missions) {
      if (m.previousRoute && (m.status === "REROUTING" || m.id === focus?.missionId)) {
        shapes.push({ id: `rt-prev:${m.id}`, geometry: { type: "LineString", coordinates: m.previousRoute.path }, color: "#94a3b8", dashed: true, weight: 3, label: `${m.code} previous route (v${m.previousRoute.version}, ${m.previousRoute.etaMinutes} min)` });
      }
      if (m.route) {
        const held = m.status === "ON_HOLD";
        shapes.push({
          id: `rt:${m.id}`,
          geometry: { type: "LineString", coordinates: m.route.path },
          color: held ? "#b42318" : m.status === "REROUTING" ? "#a15c07" : "#0f766e",
          dashed: held || m.route.provider === "straight-line-estimate",
          weight: m.id === focus?.missionId ? 6 : 4,
          label: `${m.code} ${held ? "HELD — " : ""}route v${m.route.version}: ${m.route.roads.join(" → ") || "direct"} · ${m.route.etaMinutes} min`,
        });
      }
    }
  }
  const markers: MapMarker[] = layers.cameras
    ? view.cameras.map((c) => ({
        id: `cam:${c.id}`,
        position: c.location,
        kind: "camera" as const,
        color: c.consent ? (c.consent.active ? "#6d28d9" : "#94a3b8") : "#334155",
        label: `${c.name}${c.consent ? ` · owner opt-in (${c.consent.active ? "consent active" : "consent revoked/expired"})` : ""}${c.latestObservation ? ` · ${c.latestObservation.label}` : ""}${c.simulated ? " · SIMULATED" : ""}`,
      }))
    : [];
  return { shapes, markers };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      notifyChanged();
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}

/* ------------------------------------------------------------------ */
/* Evidence ("Why?")                                                   */
/* ------------------------------------------------------------------ */

export function EvidenceList({ items, canReview, onReview, busy }: { items: EvidenceItem[]; canReview?: boolean; onReview?: (eventId: string, action: "confirm" | "dispute") => void; busy?: string | null }) {
  return (
    <ul className="space-y-1.5">
      {items.map((e) => {
        const a = AUTHORITY_LABELS[e.authorityLevel];
        const reviewable = canReview && onReview && !["AUTHORITATIVE_ALERT", "AUTHORITATIVE_OPERATIONAL_DATA", "COORDINATOR_CONFIRMED"].includes(e.authorityLevel);
        return (
          <li key={e.eventId} className={cn("rounded border border-line bg-white px-2 py-1.5 text-xs", e.stale && "opacity-60")}>
            <div className="flex flex-wrap items-center gap-1">
              <Pill className={a.cls}>{a.label}</Pill>
              {e.simulated ? <SimBadge /> : null}
              {e.stale ? <Pill className="bg-slate-100 text-slate-500">stale</Pill> : null}
              <span className="ml-auto text-[11px] text-muted">{clock(e.observedAt)}</span>
            </div>
            <div className="mt-0.5 text-ink">{e.label}</div>
            <div className="text-[11px] text-muted">
              {e.sourceName}
              {e.expiresAt ? ` · until ${clock(e.expiresAt)}` : ""}
            </div>
            {reviewable ? (
              <div className="mt-1 flex gap-1">
                <Button size="sm" variant="ghost" busy={busy === `confirm:${e.eventId}`} onClick={() => onReview!(e.eventId, "confirm")}>
                  <ThumbsUp className="h-3 w-3" /> Confirm
                </Button>
                <Button size="sm" variant="ghost" busy={busy === `dispute:${e.eventId}`} onClick={() => onReview!(e.eventId, "dispute")}>
                  <ThumbsDown className="h-3 w-3" /> Dispute
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

export function ClusterCard({ c, canReview, onFocus, focused }: { c: ClusterView; canReview: boolean; onFocus?: (id: string) => void; focused?: boolean }) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  const actionable = c.actionableEffects.filter((e) => e.kind !== "ADVISORY");
  const review = (eventId: string, action: "confirm" | "dispute") => act.run(`${action}:${eventId}`, () => api(`/api/ops/events/${encodeURIComponent(eventId)}`, { body: { action } }));
  return (
    <li className={cn("px-3 py-2.5", focused && "bg-brand-soft")}>
      <button className="block w-full text-left" onClick={() => onFocus?.(c.id)}>
        <div className="flex flex-wrap items-center gap-1">
          <VerificationBadge status={c.status} />
          {c.simulated ? <SimBadge /> : null}
          {c.publicDetailLevel === "AREA_ONLY" ? <Pill className="bg-slate-100 text-slate-600" title="Details withheld by the source; CoORDINATE does not reconstruct them">details withheld</Pill> : null}
          {c.latencySeconds ? <Pill className="bg-slate-100 text-slate-600">delayed ~{Math.round(c.latencySeconds / 60)} min</Pill> : null}
          <span className="ml-auto text-[11px] font-semibold text-muted">{c.confidence} confidence</span>
        </div>
        <div className="mt-1 text-sm font-semibold text-ink">{c.title}</div>
      </button>
      <div className="mt-1 text-xs">
        {actionable.length ? (
          <span className="font-semibold text-life">
            <Zap className="mr-0.5 inline h-3 w-3" />
            Actionable: {actionable.map((e) => EFFECT_TEXT[e.kind]).join(", ")}
          </span>
        ) : c.pendingEffects.length && !c.stale ? (
          <span className="text-trained">
            <CircleSlash className="mr-0.5 inline h-3 w-3" />
            Not acted on — {c.pendingEffects[0].reason}
          </span>
        ) : (
          <span className="text-muted">Awareness only — no operational effect</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span>
          {c.evidence.length} source item(s) · {c.sourceTypes.length} source type(s)
        </span>
        {c.expiresAt ? (
          <span>
            <Clock className="mr-0.5 inline h-3 w-3" />
            until {clock(c.expiresAt)}
          </span>
        ) : null}
        <button className="ml-auto inline-flex items-center gap-0.5 font-semibold text-brand hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Why?
        </button>
      </div>
      {open ? (
        <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
          <p className="text-[11px] text-muted">
            {c.status === "AUTHORITATIVE"
              ? "Actionable: an official source reports it (rule A1)."
              : c.status === "CORROBORATED"
                ? "Actionable: independent sources agree (rules A1/A2)."
                : c.status === "UNVERIFIED"
                  ? "Not actionable: media, camera AI or a single unverified report can never change routes or holds on its own (rule A3). A coordinator can confirm it after checking."
                  : c.status === "STALE"
                    ? "Stale sources are shown but never acted on (rule A4)."
                    : "Disputed by a coordinator."}
          </p>
          <EvidenceList items={c.evidence} canReview={canReview} onReview={(id, a) => void review(id, a)} busy={act.busy} />
          {act.error ? <p className="text-xs text-life">{act.error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function ConditionsPanel({ view, canReview, focus, onFocus }: { view: OpsView; canReview: boolean; focus?: string; onFocus?: (id: string) => void }) {
  const [showStale, setShowStale] = useState(false);
  const list = view.clusters.filter((c) => showStale || !c.stale);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted">
        <span>
          <strong className="text-ink">{view.summary.actionable}</strong> actionable · <strong className="text-ink">{view.summary.pendingReview}</strong> awaiting corroboration
        </span>
        {view.summary.stale ? (
          <label className="ml-auto flex items-center gap-1">
            <input type="checkbox" checked={showStale} onChange={(e) => setShowStale(e.target.checked)} /> show {view.summary.stale} stale
          </label>
        ) : null}
      </div>
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <ClusterCard key={c.id} c={c} canReview={canReview && view.mode === "SCENARIO"} focused={focus === c.id} onFocus={onFocus} />
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">{view.mode === "LIVE" ? "No live conditions reported by connected sources in the operation area." : "No conditions."}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

export function HoldBlock({ hold, code, canResume, busy, onResume }: { hold: NonNullable<OpsMissionView["hold"]>; code: string; canResume: boolean; busy?: boolean; onResume?: () => void }) {
  return (
    <div className={cn("rounded-md p-2 text-xs", hold.conditionCleared ? "bg-done-soft" : "bg-life-soft")}>
      <div className={cn("flex items-center gap-1 font-bold", hold.conditionCleared ? "text-done" : "text-life")}>
        {hold.conditionCleared ? <CheckCircle2 className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
        {hold.conditionCleared ? `Hold condition cleared (H-01) — resume when ready` : `Held by rule ${hold.ruleId}`}
      </div>
      <p className="mt-0.5 text-ink">{hold.reason}</p>
      {!hold.conditionCleared ? (
        <p className="mt-0.5">
          <strong>Team told:</strong> {hold.instruction}
        </p>
      ) : null}
      {hold.welfareNote && !hold.conditionCleared ? (
        <p className="mt-1 rounded bg-white/70 px-1.5 py-1 font-semibold text-pro">
          <AlertTriangle className="mr-0.5 inline h-3 w-3" />
          {hold.welfareNote}
        </p>
      ) : null}
      {canResume && hold.conditionCleared ? (
        <Button size="sm" className="mt-1.5" busy={busy} onClick={onResume}>
          <PlayCircle className="h-3.5 w-3.5" /> Resume {code}
        </Button>
      ) : !hold.conditionCleared ? (
        <p className="mt-1 text-[11px] text-muted">
          <Lock className="mr-0.5 inline h-3 w-3" />
          Resume unlocks automatically when the condition ends{hold.expiresAt ? ` (${clock(hold.expiresAt)})` : ""}. Safety holds cannot be overridden.
        </p>
      ) : null}
    </div>
  );
}

export function RouteSummary({ route: r, previous, highlight, preview, children }: { route: RoutePlan; previous?: RoutePlan; highlight?: boolean; preview?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", highlight ? "border-trained bg-trained-soft" : "border-line bg-slate-50")}>
      <div className="flex flex-wrap items-center gap-1">
        <Route className="h-3.5 w-3.5 text-active" aria-hidden />
        <span className="font-semibold text-ink">
          {preview ? "Planned route" : `Route v${r.version}`}: {r.etaMinutes} min
          {previous ? <span className="font-normal text-muted"> (was {previous.etaMinutes} min)</span> : null}
        </span>
        <span className="text-muted">· {r.distanceKm} km · from {r.origin.label}</span>
        <Pill className="ml-auto bg-white text-slate-600 ring-1 ring-line">{r.provider === "demo-road-graph" ? "scenario road graph" : r.provider === "azure-maps" ? "Azure Maps + traffic" : "estimate only"}</Pill>
      </div>
      <div className="mt-0.5 text-ink">{r.roads.join(" → ") || "Direct"}</div>
      <div className="mt-0.5 text-[11px] text-muted">{r.statement}</div>
      {r.avoided.length ? <div className="mt-0.5 text-[11px] text-trained">Avoiding: {r.avoided.map((a) => a.title).join("; ")}</div> : null}
      {children}
    </div>
  );
}

export function DecisionRecords({ decisions }: { decisions: DecisionRecord[] }) {
  const [open, setOpen] = useState(false);
  if (!decisions.length) return null;
  return (
    <div>
      <button className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <HelpCircle className="h-3 w-3" /> Why? ({decisions.length} decision record{decisions.length === 1 ? "" : "s"})
      </button>
      {open ? (
        <ol className="mt-1 space-y-1.5 border-l-2 border-line pl-2">
          {[...decisions].reverse().map((d) => (
            <li key={d.id} className="text-xs">
              <div className="flex flex-wrap items-center gap-1">
                <Pill className="bg-ink text-white">{d.decisionType.replace(/_/g, " ").toLowerCase()}</Pill>
                {d.rulesApplied.map((rid) => (
                  <span key={rid} className="font-mono text-[11px] font-bold text-muted">
                    {rid}
                  </span>
                ))}
                <span className="ml-auto text-[11px] text-muted">
                  {clock(d.createdAt)} · {d.by === "rules" ? "rules engine" : d.by}
                </span>
              </div>
              <div className="font-semibold text-ink">{d.result}</div>
              <div className="text-muted">{d.explanation}</div>
              {d.evidence.length ? (
                <div className="mt-1">
                  <EvidenceList items={d.evidence} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function MissionOpsCard({ m, canAct, focused, onFocus }: { m: OpsMissionView; canAct: boolean; focused?: boolean; onFocus?: (id: string) => void }) {
  const act = useAction();
  const run = (action: string) => act.run(action, () => api(`/api/missions/${m.id}`, { body: { action } }));
  return (
    <li className={cn("px-3 py-2.5", focused && "bg-brand-soft", m.status === "ON_HOLD" && "border-l-4 border-life", m.status === "REROUTING" && "border-l-4 border-trained")}>
      <button className="block w-full text-left" onClick={() => onFocus?.(m.id)}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-bold text-forming">{m.code}</span>
          <MissionStatusBadge status={m.status} />
          <Pill className="bg-slate-100 text-slate-600">{m.exposure === "OUTDOOR" ? "outdoor work" : "indoor work"}</Pill>
        </div>
        <div className="mt-0.5 text-sm font-semibold text-ink">{m.title}</div>
        <div className="text-xs text-muted">
          {m.incidentNumber} · {m.locationLabel}
          {m.lead ? ` · lead ${m.lead.name}` : ""}
        </div>
      </button>
      {m.hold ? (
        <div className="mt-2">
          <HoldBlock hold={m.hold} code={m.code} canResume={canAct} busy={act.busy === "resume"} onResume={() => void run("resume")} />
        </div>
      ) : null}
      {m.route && (["DISPATCHED", "REROUTING"].includes(m.status) || (m.status === "ON_HOLD" && m.heldFrom !== "IN_PROGRESS")) ? (
        <div className="mt-2">
          <RouteSummary route={m.route} previous={m.previousRoute} highlight={m.status === "REROUTING"}>
            {m.status === "REROUTING" && canAct ? (
              <Button size="sm" className="mt-1.5" busy={act.busy === "ack-route"} onClick={() => void run("ack-route")}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Team has the new route
              </Button>
            ) : null}
          </RouteSummary>
        </div>
      ) : null}
      <div className="mt-1.5">
        <DecisionRecords decisions={m.decisions} />
      </div>
      {act.error ? <p className="mt-1 text-xs text-life">{act.error}</p> : null}
    </li>
  );
}

export function MissionOpsPanel({ view, canAct, focus, onFocus }: { view: OpsView; canAct: boolean; focus?: string; onFocus?: (id: string) => void }) {
  const order = { ON_HOLD: 0, REROUTING: 1, DISPATCHED: 2, IN_PROGRESS: 3 } as Record<string, number>;
  const list = [...view.missions].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  return (
    <div>
      <div className="border-b border-line px-3 py-2 text-xs text-muted">
        Every active mission is re-checked whenever conditions change. <strong className="text-ink">{view.summary.held}</strong> held · <strong className="text-ink">{view.summary.rerouting}</strong> rerouting
      </div>
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <MissionOpsCard key={m.id} m={m} canAct={canAct} focused={focus === m.id} onFocus={onFocus} />
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">No missions in the field.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data sources                                                        */
/* ------------------------------------------------------------------ */

export function ProviderStateBadge({ state }: { state: ProviderState }) {
  const s = PROVIDER_STATE_STYLE[state];
  return (
    <Pill className={s.cls}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </Pill>
  );
}

export function SourcesPanel({ providers }: { providers: ProviderRow[] }) {
  const groups: { key: ProviderRow["group"]; title: string; note: string }[] = [
    { key: "SCENARIO", title: "Exercise data", note: "Fictional scenario — every item is labelled SIMULATED." },
    { key: "SERVICE", title: "Azure services", note: "State comes from the outcome of real calls in this process." },
    { key: "LIVE_FEED", title: "Live Virginia sources", note: "Polled server-side and stored with provenance (see /live). Nothing is shown as live unless data actually arrived." },
  ];
  return (
    <div className="divide-y divide-line">
      {groups.map((g) => {
        const rows = providers.filter((p) => p.group === g.key);
        if (!rows.length) return null;
        return (
          <div key={g.key} className="px-3 py-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{g.title}</h3>
            <p className="mb-1.5 text-[11px] text-muted">{g.note}</p>
            <ul className="space-y-1.5">
              {rows.map((p) => (
                <li key={p.id} className="rounded border border-line px-2 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold text-ink">{p.name}</span>
                    {p.tier ? <span className="text-[10px] font-bold text-muted">TIER {p.tier}</span> : null}
                    <span className="ml-auto">
                      <ProviderStateBadge state={p.state} />
                    </span>
                  </div>
                  <div className="mt-0.5 text-muted">{p.detail}</div>
                  {p.describes ? <div className="text-[11px] text-muted">{p.describes}</div> : null}
                  {p.lastSuccessAt ? <div className="text-[11px] text-muted">Last success {timeAgo(p.lastSuccessAt)}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exercise controls                                                   */
/* ------------------------------------------------------------------ */

export function ScenarioControls({ view, onResult }: { view: OpsView; onResult?: (v: OpsView) => void }) {
  const act = useAction();
  const [last, setLast] = useState<OpsView["changes"]>(undefined);
  if (!view.injections?.length) return null;
  const inject = async (id: string) => {
    const v = await act.run(id, () => api<OpsView>("/api/ops/scenario", { body: { inject: id } }));
    if (v) {
      setLast(v.changes ?? []);
      onResult?.(v);
    }
  };
  return (
    <div className="border-b border-line bg-forming-soft/40 px-3 py-2">
      <h3 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-forming">
        <Radio className="h-3.5 w-3.5" /> Exercise controls (simulated conditions)
      </h3>
      <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {view.injections.map((i) => (
          <button
            key={i.id}
            title={i.detail}
            disabled={!!act.busy}
            onClick={() => void inject(i.id)}
            className="rounded border border-forming/30 bg-white px-2 py-1 text-left text-xs font-semibold text-ink hover:bg-forming-soft disabled:opacity-50"
          >
            {act.busy === i.id ? "…" : i.label}
          </button>
        ))}
      </div>
      {act.error ? <p className="mt-1 text-xs text-life">{act.error}</p> : null}
      {last !== undefined ? (
        <div className="mt-1.5 text-xs">
          {last.length ? (
            <ul className="space-y-0.5">
              {last.map((c) => (
                <li key={c.missionId + c.status} className="text-ink">
                  <Zap className="mr-0.5 inline h-3 w-3 text-trained" />
                  {c.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Reassessed every active mission — no change required.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cameras                                                             */
/* ------------------------------------------------------------------ */

export function CamerasPanel({ view, incidents, canAct }: { view: OpsView; incidents: IncidentSummary[]; canAct: boolean }) {
  const act = useAction();
  const [frame, setFrame] = useState<Record<string, { url?: string; observation?: string }>>({});
  const snapshot = async (c: CameraView, incidentId?: string) => {
    const r = await act.run(`snap:${c.id}`, () => api<{ snapshotUrl?: string; observation?: string }>(`/api/cameras/${c.id}`, { body: { action: "snapshot", incidentId } }));
    if (r) setFrame((f) => ({ ...f, [c.id]: { url: r.snapshotUrl, observation: r.observation } }));
  };
  const revoke = (c: CameraView) => act.run(`revoke:${c.id}`, () => api(`/api/cameras/${c.id}`, { body: { action: "revoke" } }));
  if (!view.cameras.length) return <p className="p-4 text-sm text-muted">No cameras available in this view.</p>;
  return (
    <div>
      <p className="border-b border-line px-3 py-2 text-[11px] text-muted">
        Cameras are evidence sources, not surveillance: no facial recognition, no person or plate tracking, no continuous recording. Every view is logged. Camera AI observations are never acted on without
        corroboration.
      </p>
      <ul className="divide-y divide-line">
        {view.cameras.map((c) => {
          const near = c.consent
            ? incidents.filter((i) => ["OPEN", "TEAM_FORMING", "ACTIVE"].includes(i.status) && Math.hypot((i.location.lat - c.location.lat) * 111, (i.location.lng - c.location.lng) * 88) <= 0.4)
            : [];
          const f = frame[c.id];
          return (
            <li key={c.id} className="px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1">
                <Camera className="h-3.5 w-3.5 text-muted" aria-hidden />
                <span className="font-semibold text-ink">{c.name}</span>
                {c.simulated ? <SimBadge /> : null}
              </div>
              <div className="text-muted">{c.provider}</div>
              {c.consent ? (
                <div className={cn("mt-1 rounded px-2 py-1", c.consent.active ? "bg-forming-soft" : "bg-slate-100")}>
                  <div className="flex items-center gap-1 font-semibold">
                    <ShieldCheck className="h-3 w-3" /> Owner consent: {c.consent.active ? `${c.consent.scope.replace(/_/g, " ").toLowerCase()}` : c.consent.revoked ? "revoked" : "expired"}
                  </div>
                  <div className="text-muted">{c.consent.purpose}</div>
                  {c.consent.expiresAt && c.consent.active ? <div className="text-muted">Expires {clock(c.consent.expiresAt)}</div> : null}
                </div>
              ) : null}
              {c.latestObservation ? (
                <div className="mt-1 text-forming">
                  <Eye className="mr-0.5 inline h-3 w-3" />
                  {c.latestObservation.label} · {timeAgo(c.latestObservation.at)}
                </div>
              ) : null}
              {canAct ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {!c.consent ? (
                    <Button size="sm" variant="secondary" busy={act.busy === `snap:${c.id}`} onClick={() => void snapshot(c)}>
                      <Eye className="h-3 w-3" /> View current frame
                    </Button>
                  ) : c.consent.active ? (
                    near.length ? (
                      near.slice(0, 2).map((i) => (
                        <Button key={i.id} size="sm" variant="secondary" busy={act.busy === `snap:${c.id}`} onClick={() => void snapshot(c, i.id)}>
                          <Camera className="h-3 w-3" /> Request one snapshot for {i.number}
                        </Button>
                      ))
                    ) : (
                      <span className="text-[11px] text-muted">No open incident at this address — snapshots are purpose-bound.</span>
                    )
                  ) : null}
                  {c.consent?.active ? (
                    <Button size="sm" variant="ghost" busy={act.busy === `revoke:${c.id}`} onClick={() => void revoke(c)}>
                      Record owner revocation
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {f?.url ? (
                <figure className="mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={`Frame from ${c.name}${f.observation ? `: ${f.observation}` : ""}`} className="w-full rounded border border-line" />
                  <figcaption className="mt-0.5 text-[11px] text-muted">{c.simulated ? "Simulated frame. " : ""}{f.observation ?? "No automated observation."} Access logged.</figcaption>
                </figure>
              ) : null}
              {c.accessLog?.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] font-semibold text-muted">
                    <Database className="mr-0.5 inline h-3 w-3" />
                    Access log ({c.accessLog.length})
                  </summary>
                  <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted">
                    {c.accessLog
                      .slice()
                      .reverse()
                      .map((l, k) => (
                        <li key={k}>
                          {clock(l.at)} · {l.action} · {l.by}
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
      {act.error ? <p className="px-3 pb-2 text-xs text-life">{act.error}</p> : null}
    </div>
  );
}

export function LiveNotice({ view }: { view: OpsView }) {
  if (view.mode !== "LIVE") return null;
  const live = view.providers.filter((p) => p.group === "LIVE_FEED" && (p.state === "LIVE" || p.state === "LIVE_DELAYED"));
  return (
    <Callout tone={live.length ? "info" : "warn"} title={live.length ? `Live operation — ${live.length} source(s) delivering current data` : "Live operation — no live source is delivering current data"}>
      Real requests, volunteers and public feeds. Official warnings and closures hold and reroute missions here; unverified reports never act alone.{" "}
      {live.length ? "" : "Until a source recovers, holds can be added but never cleared, and nothing is shown as current. "}
      <a href="/live" className="font-semibold underline">
        Feeds, sources and provenance →
      </a>
    </Callout>
  );
}

/* ------------------------------------------------------------------ */
/* Incident evidence (workbench)                                        */
/* ------------------------------------------------------------------ */

export function IncidentEvidence({ detail, canAct }: { detail: IncidentDetail; canAct: boolean }) {
  const act = useAction();
  const [shot, setShot] = useState<{ url?: string; observation?: string } | null>(null);
  const { evidence, optInCameras } = detail;
  if (!evidence.length && !optInCameras.length) return null;
  const snapshot = async (cameraId: string) => {
    const r = await act.run(`snap:${cameraId}`, () => api<{ snapshotUrl?: string; observation?: string }>(`/api/cameras/${cameraId}`, { body: { action: "snapshot", incidentId: detail.incident.id } }));
    if (r) setShot({ url: r.snapshotUrl, observation: r.observation });
  };
  return (
    <section className="min-w-0 rounded-lg border border-line bg-white" aria-labelledby="ev-h">
      <div className="border-b border-line px-4 py-3">
        <h2 id="ev-h" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Eye className="h-4 w-4 text-forming" /> Operational evidence
        </h2>
        <p className="text-xs text-muted">Reports and camera observations linked to this incident. Evidence informs people; it never dispatches anyone.</p>
      </div>
      <div className="space-y-3 p-4">
        {optInCameras.map((c) => (
          <div key={c.id} className={cn("rounded-md p-2 text-xs", c.active ? "bg-forming-soft" : "bg-slate-100")}>
            <div className="flex items-center gap-1 font-semibold text-ink">
              <ShieldCheck className="h-3.5 w-3.5" /> {c.name} — {c.active ? "owner consent active" : "consent revoked or expired"}
            </div>
            <div className="text-muted">{c.purpose}</div>
            {canAct && c.active ? (
              <Button size="sm" variant="secondary" className="mt-1.5" busy={act.busy === `snap:${c.id}`} onClick={() => void snapshot(c.id)}>
                <Camera className="h-3.5 w-3.5" /> Request one owner-authorized snapshot
              </Button>
            ) : null}
          </div>
        ))}
        {shot?.url ? (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.url} alt={shot.observation ?? "Owner-authorized snapshot"} className="w-full rounded border border-line" />
            <figcaption className="mt-0.5 text-[11px] text-muted">One frame, access logged, kept 6 h. {shot.observation}</figcaption>
          </figure>
        ) : null}
        {evidence.map((e) => (
          <div key={e.clusterId}>
            <div className="flex flex-wrap items-center gap-1 text-sm font-semibold text-ink">
              <VerificationBadge status={e.status} /> {e.title}
            </div>
            <div className="mt-1">
              <EvidenceList items={e.items} />
            </div>
            {e.media.map((m) => (
              <figure key={m.eventId} className="mt-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.label} className="w-full rounded border border-line" />
                <figcaption className="text-[11px] text-muted">
                  {m.label} · {m.humanVerified ? "confirmed by a coordinator" : "automated observation — not independently verified"}
                </figcaption>
              </figure>
            ))}
          </div>
        ))}
        {act.error ? <p className="text-xs text-life">{act.error}</p> : null}
      </div>
    </section>
  );
}
