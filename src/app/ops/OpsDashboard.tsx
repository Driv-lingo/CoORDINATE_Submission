"use client";

import { AlertTriangle, Bot, Camera, Cpu, Database, FileText, Globe2, Layers, MapPin, RefreshCw, Route, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { HazardChip, PriorityBadge, STATUS_STYLE, StatusBadge, StatusIcon, TriageBadge } from "@/components/badges";
import { OpsMap, type MapMarker } from "@/components/Map";
import { CamerasPanel, ConditionsPanel, LiveNotice, MissionOpsPanel, opsMapLayers, ScenarioControls, SourcesPanel, type OpsLayers } from "@/components/ops/OpsPanels";
import { CoordinatorOnlyNotice } from "@/components/PersonaNotice";
import { useSystem, useModeHref } from "@/components/SystemProvider";
import { Button, Callout, Card, CardHeader, Pill, Stat } from "@/components/ui";
import { ASSET_LABELS, CATEGORY_LABELS, INCIDENT_STATUS_LABELS, MISSION_STATUS_LABELS, NEED_LABELS, VULNERABILITY_LABELS } from "@/domain/catalog";
import type { DisplayStatus, IncidentSummary, OpsView, Snapshot } from "@/domain/dto";
import type { IncidentCategory, PriorityLevel } from "@/domain/types";
import { api, useApi, useOnChanged } from "@/lib/api";
import { NeedsByPath } from "@/components/navigator/NeedsByPath";
import { cn, timeAgo } from "@/lib/format";

const STATUS_ORDER: DisplayStatus[] = ["GUIDED", "OPEN", "AWAITING_RESOURCES", "TEAM_FORMING", "ACTIVE", "RESOLVED", "ESCALATED"];
type Tab = "field" | "conditions" | "cameras" | "sources" | "sitrep";
const PRIORITIES: PriorityLevel[] = ["P1", "P2", "P3", "P4"];

export default function OpsDashboard() {
  const mh = useModeHref();
  const sys = useSystem();
  const snap = useApi<Snapshot>("/api/snapshot", { pollMs: 5000 });
  useOnChanged(useCallback(() => void snap.refresh(), [snap.refresh])); // eslint-disable-line react-hooks/exhaustive-deps
  const [statuses, setStatuses] = useState<Set<DisplayStatus>>(new Set());
  const [priorities, setPriorities] = useState<Set<PriorityLevel>>(new Set());
  const [category, setCategory] = useState<IncidentCategory | "">("");
  const [locality, setLocality] = useState("");
  const [need, setNeed] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showResources, setShowResources] = useState(true);
  // The toggle between the exercise and live feeds is gone: this page is live, and /demo/ops is the exercise.
  const liveMode = false;
  const [tab, setTab] = useState<Tab>("field");
  const [focus, setFocus] = useState<{ clusterId?: string; missionId?: string }>({});
  const [layers, setLayers] = useState<OpsLayers>({ hazards: true, unverified: true, routes: true, cameras: true });
  const ops = useApi<OpsView>("/api/ops", { pollMs: 5000 });
  useOnChanged(useCallback(() => void ops.refresh(), [ops.refresh])); // eslint-disable-line react-hooks/exhaustive-deps
  const view = ops.data;

  const data = snap.data;
  const localities = useMemo(() => Array.from(new Set(data?.incidents.map((i) => i.locality) ?? [])).sort(), [data]);
  const needOptions = useMemo(() => {
    const assets = new Set<string>();
    const roles = new Set<string>();
    for (const i of data?.incidents ?? []) {
      i.requiredAssets.forEach((a) => assets.add(`asset:${a}`));
      i.requiredRoles.forEach((r) => roles.add(`role:${r}`));
    }
    return [...[...roles].sort(), ...[...assets].sort()];
  }, [data]);

  const filtered = useMemo(() => {
    const list = data?.incidents ?? [];
    const query = q.trim().toLowerCase();
    return list.filter(
      (i) =>
        (statuses.size === 0 || statuses.has(i.displayStatus)) &&
        (priorities.size === 0 || priorities.has(i.priority)) &&
        (!category || i.category === category) &&
        (!locality || i.locality === locality) &&
        (!need || (need.startsWith("asset:") ? i.requiredAssets.includes(need.slice(6) as never) : i.requiredRoles.includes(need.slice(5)))) &&
        (!query || `${i.number} ${i.summary} ${i.locationLabel} ${i.missionCode ?? ""}`.toLowerCase().includes(query)),
    );
  }, [data, statuses, priorities, category, locality, need, q]);

  const sel = data?.incidents.find((i) => i.id === selected) ?? null;

  const opsLayers = useMemo(() => opsMapLayers(view, layers, focus), [view, layers, focus]);

  const markers: MapMarker[] = useMemo(() => {
    if (liveMode) return opsLayers.markers;
    const inc: MapMarker[] = filtered.map((i) => ({
      id: i.id,
      position: i.location,
      kind: "incident",
      color: STATUS_STYLE[i.displayStatus].hex,
      glyph: i.priority,
      selected: i.id === selected,
      pulse: i.priority === "P1" && i.displayStatus !== "RESOLVED",
      label: `${i.number} · ${INCIDENT_STATUS_LABELS[i.displayStatus]} · ${i.summary}`,
    }));
    const res: MapMarker[] = showResources
      ? (data?.responders ?? []).map((r) => ({
          id: `r:${r.id}`,
          position: r.location,
          kind: r.kind === "ORGANIZATION" ? "org" : "person",
          color: r.state === "DEPLOYED" ? "#0f766e" : r.state === "AVAILABLE" ? "#475569" : "#94a3b8",
          hollow: r.state === "UNAVAILABLE" || r.state === "UNVERIFIED",
          label: `${r.name} — ${r.state.toLowerCase()}${r.missionCode ? ` (${r.missionCode})` : ""}`,
        }))
      : [];
    return [...res, ...opsLayers.markers, ...inc];
  }, [filtered, data, selected, showResources, liveMode, opsLayers.markers]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    apply(n);
  };
  const clearFilters = () => {
    setStatuses(new Set());
    setPriorities(new Set());
    setCategory("");
    setLocality("");
    setNeed("");
    setQ("");
  };
  const filtersOn = statuses.size || priorities.size || category || locality || need || q;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink">Operations dashboard</h1>
          <p className="text-sm text-muted">
            {sys.operation} · coordinator view · {data ? `updated ${timeAgo(data.generatedAt)}` : "loading…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sys.mode === "live" ? (
            <Link href="/live" className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50">
              <Globe2 className="h-4 w-4" /> Live feeds &amp; sources
            </Link>
          ) : null}
          <Link href={mh("/request")} className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50">
            + New request
          </Link>
          {sys.mode === "demo" ? (
            <Link href="/demo" className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
              Guided demo
            </Link>
          ) : null}
        </div>
      </div>

      <CoordinatorOnlyNotice what="Assembling, dispatching and verifying teams" />

      {view && !liveMode && (view.summary.held || view.summary.rerouting) ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-life bg-life-soft px-3 py-2 text-sm">
          <ShieldAlert className="h-5 w-5 text-life" aria-hidden />
          <strong className="text-life">
            {view.summary.held ? `${view.summary.held} mission${view.summary.held === 1 ? "" : "s"} held for safety` : ""}
            {view.summary.held && view.summary.rerouting ? " · " : ""}
            {view.summary.rerouting ? `${view.summary.rerouting} rerouting — awaiting team acknowledgement` : ""}
          </strong>
          <span className="text-ink">Rules acted on official or corroborated conditions only.</span>
          <button className="ml-auto font-semibold text-brand hover:underline" onClick={() => setTab("field")}>
            Review field operations →
          </button>
        </div>
      ) : null}
      {view ? <LiveNotice view={view} /> : null}

      {/* Status tiles double as filters */}
      <div role="group" aria-label="Filter by status" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {STATUS_ORDER.map((s) => {
          const on = statuses.has(s);
          return (
            <button
              key={s}
              onClick={() => toggle(statuses, s, setStatuses)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-white px-3 py-2 text-left transition-shadow hover:shadow",
                on ? "border-ink ring-2 ring-ink" : "border-line",
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white" style={{ background: STATUS_STYLE[s].hex }}>
                <StatusIcon status={s} className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-2xl font-bold leading-none tabular-nums text-ink">{data?.counts[s] ?? "–"}</span>
                <span className="text-xs font-semibold text-muted">{INCIDENT_STATUS_LABELS[s]}</span>
              </span>
            </button>
          );
        })}
      </div>

      {data ? (
        <Card className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="People helped" value={data.kpis.peopleHelped} tone="done" />
          <Stat label="People waiting" value={data.kpis.peopleWaiting} tone="life" />
          <Stat label="Volunteers deployed" value={data.kpis.volunteersDeployed} tone="active" />
          <Stat label="Volunteers ready" value={data.kpis.volunteersReady} />
          <Stat label="Handoffs recommended" value={data.kpis.escalationsRecommended} hint={`${data.kpis.escalationsContacted} contact recorded`} />
          <Stat label="Avg. request → dispatch" value={data.kpis.avgMinutesToDispatch !== null ? `${data.kpis.avgMinutesToDispatch} min` : "—"} tone="brand" />
          <Stat label="Volunteer hours" value={data.kpis.volunteerHours} hint={`≈ $${data.kpis.estimatedValueUsd.toLocaleString()} donated value`} />
        </Card>
      ) : null}
      {data ? <NeedsByPath kpis={data.kpis} /> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(320px,380px)_1fr] xl:grid-cols-[minmax(320px,380px)_1fr_360px]">
        {/* Queue + filters */}
        <Card className="flex max-h-[calc(100vh-150px)] min-h-[420px] flex-col lg:row-span-2 xl:row-span-1">
          <div className="space-y-2 border-b border-line p-3">
            <label className="relative block">
              <span className="sr-only">Search incidents</span>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, place, mission…" className="w-full rounded-md border border-line py-2 pl-8 pr-2 text-sm" />
            </label>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by urgency">
              <span className="mr-1 text-xs font-semibold text-muted">Urgency</span>
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  aria-pressed={priorities.has(p)}
                  onClick={() => toggle(priorities, p, setPriorities)}
                  className={cn("rounded px-2 py-0.5 text-xs font-bold ring-1", priorities.has(p) ? "bg-ink text-white ring-ink" : "bg-white text-ink ring-line hover:bg-slate-50")}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value as IncidentCategory | "")} className="rounded border border-line px-1.5 py-1 text-xs">
                <option value="">All categories</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by geography" value={locality} onChange={(e) => setLocality(e.target.value)} className="rounded border border-line px-1.5 py-1 text-xs">
                <option value="">All areas</option>
                {localities.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <select aria-label="Filter by resource need" value={need} onChange={(e) => setNeed(e.target.value)} className="rounded border border-line px-1.5 py-1 text-xs">
                <option value="">Any resource</option>
                {needOptions.map((n) => (
                  <option key={n} value={n}>
                    {n.startsWith("asset:") ? ASSET_LABELS[n.slice(6) as keyof typeof ASSET_LABELS] : n.slice(5)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                {filtered.length} of {data?.incidents.length ?? 0} incidents · sorted by priority
              </span>
              {filtersOn ? (
                <button className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" onClick={clearFilters}>
                  <X className="h-3 w-3" /> Clear filters
                </button>
              ) : null}
            </div>
          </div>
          <ul className="flex-1 divide-y divide-line overflow-y-auto" aria-label="Incident queue">
            {filtered.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => setSelected(i.id === selected ? null : i.id)}
                  aria-pressed={i.id === selected}
                  className={cn("block w-full px-3 py-2.5 text-left hover:bg-slate-50", i.id === selected && "bg-brand-soft")}
                >
                  <IncidentRow i={i} />
                </button>
              </li>
            ))}
            {!filtered.length && data ? <li className="p-6 text-center text-sm text-muted">No incidents match these filters.</li> : null}
          </ul>
        </Card>

        {/* Map */}
        <Card className="relative min-h-[420px] overflow-hidden lg:h-[calc(100vh-150px)]">
          <OpsMap
            markers={markers}
            shapes={opsLayers.shapes}
            fit
            fitKey={`${liveMode}-${filtered.length}-${locality}-${category}`}
            onSelect={(id) => {
              if (id.startsWith("cam:")) setTab("cameras");
              else if (!id.startsWith("r:")) setSelected(id);
            }}
            className="h-full min-h-[420px] w-full"
            ariaLabel="Operations map of incidents, resources, hazards, routes and cameras"
          />
          <details open className="absolute right-2 top-2 z-[500] max-w-[240px] rounded-md bg-white/95 text-xs shadow ring-1 ring-line">
            <summary className="cursor-pointer px-2 py-1.5 font-semibold text-ink">Legend &amp; layers</summary>
            <div className="border-t border-line p-2">
              {!liveMode ? (
                <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {STATUS_ORDER.map((s) => (
                    <li key={s} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_STYLE[s].hex }} aria-hidden />
                      <span className="truncate">{INCIDENT_STATUS_LABELS[s]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
                {!liveMode ? (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={showResources} onChange={(e) => setShowResources(e.target.checked)} />
                    <Layers className="h-3 w-3" /> Resources (● people ■ orgs)
                  </label>
                ) : null}
                {(
                  [
                    ["hazards", "Official / corroborated", <AlertTriangle key="h" className="h-3 w-3 text-life" />],
                    ["unverified", "Unverified (dashed)", <AlertTriangle key="u" className="h-3 w-3 text-muted" />],
                    ["routes", "Mission routes", <Route key="r" className="h-3 w-3 text-active" />],
                    ["cameras", "Cameras", <Camera key="c" className="h-3 w-3" />],
                  ] as const
                ).map(([k, label, icon]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                    {icon} {label}
                  </label>
                ))}
              </div>
            </div>
          </details>
        </Card>

        {/* Detail / operational picture */}
        <div className="space-y-3 lg:col-start-2 xl:col-start-auto">
          {sel && !liveMode ? <QuickView i={sel} onClose={() => setSelected(null)} /> : null}
          <Card className="flex max-h-[calc(100vh-150px)] flex-col">
            <div role="tablist" aria-label="Operational picture" className="flex flex-wrap gap-0.5 border-b border-line px-2 pt-2">
              {(
                [
                  ["field", liveMode ? null : `Field ops${view?.summary.held || view?.summary.rerouting ? ` (${(view?.summary.held ?? 0) + (view?.summary.rerouting ?? 0)})` : ""}`],
                  ["conditions", `Conditions${view ? ` (${view.clusters.filter((c) => !c.stale).length})` : ""}`],
                  ["cameras", "Cameras"],
                  ["sources", "Data sources"],
                  ["sitrep", liveMode ? null : "SITREP"],
                ] as [Tab, string | null][]
              )
                .filter(([, label]) => label)
                .map(([k, label]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn("rounded-t-md px-2.5 py-1.5 text-xs font-semibold", tab === k ? "bg-ink text-white" : "text-muted hover:bg-slate-100")}
                  >
                    {label}
                  </button>
                ))}
            </div>
            <div className="flex-1 overflow-y-auto" role="tabpanel">
              {!view ? (
                <p className="p-4 text-sm text-muted">{ops.error ?? "Loading the operational picture…"}</p>
              ) : tab === "field" && !liveMode ? (
                <>
                  {sys.persona.kind === "coordinator" ? <ScenarioControls view={view} /> : null}
                  <MissionOpsPanel view={view} canAct={sys.persona.kind === "coordinator"} focus={focus.missionId} onFocus={(id) => setFocus({ missionId: id })} />
                </>
              ) : tab === "conditions" || (tab === "field" && liveMode) ? (
                <ConditionsPanel view={view} canReview={sys.persona.kind === "coordinator"} focus={focus.clusterId} onFocus={(id) => setFocus({ clusterId: id })} />
              ) : tab === "cameras" ? (
                <CamerasPanel view={view} incidents={data?.incidents ?? []} canAct={sys.persona.kind === "coordinator" && !liveMode} />
              ) : tab === "sources" ? (
                <SourcesPanel providers={view.providers} />
              ) : (
                <Sitrep gaps={data?.gaps ?? []} />
              )}
            </div>
            <div className="flex items-center gap-1 border-t border-line px-3 py-1.5 text-[11px] text-muted">
              <Database className="h-3 w-3" /> {view ? `${view.mode === "SCENARIO" ? "Exercise data (simulated)" : "Live operation — real data"} · updated ${timeAgo(view.generatedAt)}` : "…"}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function IncidentRow({ i }: { i: IncidentSummary }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <PriorityBadge level={i.priority} />
        <span className="font-mono text-xs font-semibold text-muted">{i.number}</span>
        <span className="ml-auto">
          <StatusBadge status={i.displayStatus} />
        </span>
      </div>
      <div className="line-clamp-2 text-sm font-medium text-ink">{i.summary}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-0.5">
          <MapPin className="h-3 w-3" aria-hidden />
          {i.locationLabel}
        </span>
        <span>· {timeAgo(i.createdAt)}</span>
        {i.missionCode ? <span className="font-semibold text-forming">· {i.missionCode}</span> : null}
        {i.pendingAdvisories ? <Pill className="bg-trained-soft text-trained">review required</Pill> : null}
      </div>
      {i.hazards.length ? (
        <div className="flex flex-wrap gap-1">
          {i.hazards.map((h) => (
            <HazardChip key={h} hazard={h} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuickView({ i, onClose }: { i: IncidentSummary; onClose: () => void }) {
  const mh = useModeHref();
  return (
    <Card aria-labelledby="qv-h">
      <CardHeader
        id="qv-h"
        title={
          <span className="flex items-center gap-2">
            <PriorityBadge level={i.priority} /> {i.number}
          </span>
        }
        right={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-slate-100" aria-label="Close incident preview">
            <X className="h-4 w-4" />
          </button>
        }
      />
      <div className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={i.displayStatus} />
          <TriageBadge level={i.triage} />
        </div>
        <p className="font-medium text-ink">{i.summary}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="font-semibold text-muted">Location</dt>
            <dd>{i.locationLabel}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">People affected</dt>
            <dd>{i.peopleAffected}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">Category</dt>
            <dd>{CATEGORY_LABELS[i.category]}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">Reported</dt>
            <dd>{timeAgo(i.createdAt)}</dd>
          </div>
        </dl>
        {i.hazards.length ? (
          <div className="flex flex-wrap gap-1">
            {i.hazards.map((h) => (
              <HazardChip key={h} hazard={h} />
            ))}
          </div>
        ) : null}
        {i.needs.length ? <div className="text-xs"><span className="font-semibold text-muted">Needs: </span>{i.needs.map((n) => NEED_LABELS[n]).join(", ")}</div> : null}
        {i.vulnerabilities.length ? <div className="text-xs"><span className="font-semibold text-muted">Vulnerability: </span>{i.vulnerabilities.map((v) => VULNERABILITY_LABELS[v]).join(", ")}</div> : null}
        {i.unfillableRoles.length ? (
          <Callout tone="warn" title="Capability gap">
            No eligible resource for: {i.unfillableRoles.join(", ")}
          </Callout>
        ) : null}
        {i.missionCode ? (
          <div className="rounded-md bg-forming-soft px-3 py-2 text-xs">
            <span className="font-semibold text-forming">
              {i.missionCode} — {i.missionTitle}
            </span>
            <div className="text-ink">{i.missionStatus ? MISSION_STATUS_LABELS[i.missionStatus] : ""}</div>
          </div>
        ) : null}
        <Link href={mh(`/ops/incidents/${i.id}`)} className="block rounded-md bg-brand px-3 py-2 text-center font-semibold text-white hover:bg-brand-dark">
          Open incident workbench →
        </Link>
      </div>
    </Card>
  );
}

function Sitrep({ gaps }: { gaps: { role: string; incidents: number }[] }) {
  const [report, setReport] = useState<{ text: string; provider: string; model?: string; generatedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setReport(await api("/api/sitrep"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card aria-labelledby="sitrep-h">
      <CardHeader
        id="sitrep-h"
        icon={<FileText className="h-4 w-4 text-brand" />}
        title="Situation report"
        subtitle="AI-drafted from current statistics — a language task, not a decision."
        right={
          <Button size="sm" variant="secondary" busy={busy} onClick={() => void run()}>
            {report ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {report ? "Refresh" : "Draft SITREP"}
          </Button>
        }
      />
      <div className="space-y-3 p-4 text-sm">
        {report ? (
          <>
            <p className="whitespace-pre-line leading-relaxed text-ink">{report.text}</p>
            <p className="flex items-center gap-1 text-xs text-muted">
              {report.provider === "azure-ai-foundry" ? <Cpu className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
              {report.provider === "azure-ai-foundry" ? `Azure AI Foundry · ${report.model}` : "Template (Foundry not configured)"} · {timeAgo(report.generatedAt)}
            </p>
          </>
        ) : (
          <p className="text-muted">Select an incident on the map or in the queue, or draft a situation report for the EOC briefing.</p>
        )}
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Capability gaps</h3>
          {gaps.length ? (
            <ul className="space-y-1">
              {gaps.map((g) => (
                <li key={g.role} className="flex items-center justify-between rounded bg-trained-soft px-2 py-1 text-xs">
                  <span className="font-semibold text-trained">{g.role}</span>
                  <span>{g.incidents} incident(s)</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">Every open role has at least one eligible resource.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
