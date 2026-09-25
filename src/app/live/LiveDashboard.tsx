"use client";

import { AlertTriangle, CloudLightning, ExternalLink, Newspaper, Radio, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { OpsMap } from "@/components/Map";
import { ConditionsPanel, opsMapLayers, type OpsLayers } from "@/components/ops/OpsPanels";
import { Callout, Card, CardHeader, Pill, Stat } from "@/components/ui";
import type { LiveEventRow, LiveView, SourceHealthLevel } from "@/domain/dto";
import { useApi, useOnChanged } from "@/lib/api";
import { cn, OPERATION_TZ, timeAgo } from "@/lib/format";

const LEVEL_STYLE: Record<SourceHealthLevel, { label: string; cls: string; dot: string }> = {
  healthy: { label: "Healthy", cls: "bg-done-soft text-done", dot: "bg-done" },
  degraded: { label: "Degraded", cls: "bg-trained-soft text-trained", dot: "bg-trained" },
  stale: { label: "Stale", cls: "bg-trained-soft text-trained", dot: "bg-trained" },
  offline: { label: "Offline", cls: "bg-life-soft text-life", dot: "bg-life" },
  unavailable: { label: "Unavailable", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  pending: { label: "Connecting", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

const LAYERS: OpsLayers = { hazards: true, unverified: true, routes: false, cameras: true };

function LevelBadge({ level }: { level: SourceHealthLevel }) {
  const s = LEVEL_STYLE[level];
  return (
    <Pill className={s.cls}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </Pill>
  );
}

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: OPERATION_TZ, timeZoneName: "short" }) : "—";
}

export default function LiveDashboard() {
  const live = useApi<LiveView>("/api/ops/live", { pollMs: 30000 });
  useOnChanged(useCallback(() => void live.refresh(), [live.refresh])); // eslint-disable-line react-hooks/exhaustive-deps
  const view = live.data;
  const [focus, setFocus] = useState<string | undefined>();
  const layers = useMemo(() => opsMapLayers(view, LAYERS, { clusterId: focus }), [view, focus]);

  const eventSources = view?.sources.filter((s) => s.category !== "CAMERAS") ?? [];
  const healthy = eventSources.filter((s) => s.level === "healthy");
  const official = view?.events.filter((e) => !e.supplemental) ?? [];
  const supplemental = view?.events.filter((e) => e.supplemental) ?? [];
  const staleCount = view?.events.filter((e) => !e.current).length ?? 0;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
            <span className="inline-flex items-center gap-1.5 rounded bg-life px-2 py-0.5 text-xs font-bold tracking-wider text-white">
              <span className={cn("h-2 w-2 rounded-full bg-white", healthy.length > 0 && "animate-pulse")} aria-hidden /> LIVE
            </span>
            Live Virginia
          </h1>
          <p className="text-sm text-muted">
            Real public feeds only — no simulated data.{" "}
            {view?.lastUpdatedAt ? `Last updated ${timeAgo(view.lastUpdatedAt)} (${fmt(view.lastUpdatedAt)}).` : view ? "No source has delivered data yet." : "Loading…"}{" "}
            {view ? (view.realtime ? "Changes are pushed as they arrive." : "Refreshes every 30 s.") : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void live.refresh()} className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <Link href="/demo" className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            Simulated demo →
          </Link>
        </div>
      </div>

      {live.error && !view ? (
        <Callout tone="danger" title="The live view could not be loaded">
          {live.error}. Nothing is shown rather than old or simulated data. It retries automatically.
        </Callout>
      ) : null}
      {view && !healthy.length ? (
        <Callout tone="warn" title="No live source is delivering current data">
          Nothing below is presented as current. This page never falls back to the simulated exercise; see each source&apos;s status on the right.
        </Callout>
      ) : null}
      {view && staleCount ? (
        <Callout tone="warn" title={`${staleCount} item(s) come from a source that is not currently healthy`}>
          They are marked STALE: they were listed by the source&apos;s last successful fetch and may no longer be accurate.
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Official alerts & events" value={view ? official.length : "…"} tone="brand" />
        <Stat label="Supplemental (news, unverified)" value={view ? supplemental.length : "…"} />
        <Stat label="Sources healthy" value={view ? `${healthy.length} / ${eventSources.filter((s) => s.level !== "unavailable").length}` : "…"} tone={healthy.length ? "done" : "life"} />
        <Stat label="Stale items" value={view ? staleCount : "…"} tone={staleCount ? "life" : "ink"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <OpsMap
              ariaLabel="Map of live Virginia alerts and events"
              className="h-[420px] w-full"
              center={{ lat: 37.55, lng: -78.8 }}
              zoom={7}
              markers={layers.markers}
              shapes={layers.shapes}
              fit={layers.shapes.length + layers.markers.length > 0}
              fitKey={`${view?.events.length ?? 0}`}
              onSelect={(id) => setFocus(id.startsWith("cl:") ? id.slice(3) : id)}
            />
          </Card>
          <Card aria-labelledby="live-events-h">
            <CardHeader id="live-events-h" icon={<CloudLightning className="h-4 w-4 text-brand" />} title="Official alerts and events" subtitle="As issued by the source. Nothing here dispatches anyone." />
            <EventList rows={official} empty={view ? "No active official alerts or events from the sources that are delivering data." : "Loading…"} />
          </Card>
          {supplemental.length ? (
            <Card aria-labelledby="live-news-h">
              <CardHeader id="live-news-h" icon={<Newspaper className="h-4 w-4 text-muted" />} title="Supplemental intelligence (news)" subtitle="Unverified media reports. Never treated as an authoritative incident and never changes a plan on its own." />
              <EventList rows={supplemental} empty="" />
            </Card>
          ) : null}
        </div>

        <div className="space-y-3">
          <Card aria-labelledby="live-src-h">
            <CardHeader id="live-src-h" icon={<Radio className="h-4 w-4 text-active" />} title="Sources" subtitle="Status comes from real fetch results." />
            <ul className="divide-y divide-line">
              {(view?.sources ?? []).map((s) => (
                <li key={s.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-ink">{s.name}</span>
                    <span className="ml-auto">
                      <LevelBadge level={s.level} />
                    </span>
                  </div>
                  <div className="mt-0.5 text-muted">{s.detail}</div>
                  {s.lastSuccessAt ? <div className="text-[11px] text-muted">Last successful fetch {timeAgo(s.lastSuccessAt)}</div> : null}
                </li>
              ))}
            </ul>
          </Card>
          {view && view.clusters.length ? (
            <Card aria-labelledby="live-cond-h">
              <CardHeader id="live-cond-h" icon={<AlertTriangle className="h-4 w-4 text-trained" />} title="Correlated conditions" subtitle="How the engine would read these feeds. Awareness only." />
              <ConditionsPanel view={view} canReview={false} focus={focus} onFocus={setFocus} />
            </Card>
          ) : null}
          <p className="px-1 text-[11px] text-muted">
            Awareness only: CoORDINATE does not contact 911 or any agency. For emergencies call 911. Data © its publishers (National Weather Service, VDOT, …); follow each
            source&apos;s link for the authoritative text.
          </p>
        </div>
      </div>
    </div>
  );
}

function EventList({ rows, empty }: { rows: LiveEventRow[]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-3 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((e) => (
        <li key={e.id} className={cn("px-4 py-2.5 text-sm", !e.current && "bg-trained-soft/40")}>
          <div className="flex flex-wrap items-center gap-1.5">
            {!e.current ? <Pill className="bg-trained-soft text-trained">STALE</Pill> : null}
            {e.severity && e.severity !== "UNKNOWN" ? <Pill className={e.severity === "EXTREME" || e.severity === "SEVERE" ? "bg-life-soft text-life" : "bg-slate-100 text-slate-700"}>{e.severity.toLowerCase()}</Pill> : null}
            {e.supplemental ? <Pill className="bg-slate-100 text-slate-600">unverified</Pill> : <Pill className="bg-brand-soft text-brand">official</Pill>}
            <span className="font-semibold text-ink">{e.title}</span>
          </div>
          {e.description ? <p className="mt-0.5 line-clamp-2 text-muted">{e.description}</p> : null}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span>Source: {e.sourceName}</span>
            <span>Issued/updated {fmt(e.provenance.sourceUpdatedAt)}</span>
            {e.provenance.expiresAt ? <span>Expires {fmt(e.provenance.expiresAt)}</span> : null}
            <span>Ingested {fmt(e.provenance.ingestedAt)}</span>
            {!e.current ? <span className="font-semibold text-trained">Source {e.sourceHealth} — not current</span> : null}
            {e.provenance.sourceUrl ? (
              <a href={e.provenance.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">
                Original <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          <details className="mt-0.5 text-[11px] text-muted">
            <summary className="cursor-pointer">Provenance</summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
              <dt>source</dt>
              <dd>{e.provenance.source}</dd>
              <dt>sourceId</dt>
              <dd className="break-all">{e.provenance.sourceId}</dd>
              <dt>observed</dt>
              <dd>{fmt(e.provenance.observedAt)}</dd>
              <dt>rawHash</dt>
              <dd className="font-mono">{e.provenance.rawHash.slice(0, 16)}…</dd>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}
