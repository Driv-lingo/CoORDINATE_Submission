"use client";

import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { HazardSummary, InterpretationPanel, RequirementsPanel, TimelinePanel, TriagePanel } from "@/components/incident/panels";
import { CandidatesPanel, MissionPanel, TeamPanel } from "@/components/incident/match";
import { useIncident } from "@/components/incident/useIncident";
import { IncidentEvidence } from "@/components/ops/OpsPanels";
import { NeedsPanel } from "@/components/navigator/Navigator";
import { PriorityBadge, StatusBadge, TriageBadge } from "@/components/badges";
import { CoordinatorOnlyNotice } from "@/components/PersonaNotice";
import { useSystem, useModeHref } from "@/components/SystemProvider";
import { Callout } from "@/components/ui";
import { timeAgo } from "@/lib/format";

export default function IncidentWorkbench({ id }: { id: string }) {
  const mh = useModeHref();
  const sys = useSystem();
  const handle = useIncident(id);
  const d = handle.data;
  const canAct = sys.persona.kind === "coordinator";

  if (handle.error && !d) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Callout tone="danger" title="Could not load incident">
          {handle.error}. It may belong to another sandbox — <Link className="underline" href={mh("/ops")}>return to operations</Link>.
        </Callout>
      </div>
    );
  }
  if (!d) return <div className="p-8 text-center text-muted">Loading incident…</div>;
  const i = d.incident;

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 px-3 py-3 sm:px-4">
      <Link href={mh("/ops")} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
        <ArrowLeft className="h-4 w-4" /> Operations dashboard
      </Link>
      <header className="rounded-lg border border-line bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge level={i.priority.level} />
          <span className="font-mono text-sm font-bold text-muted">{i.number}</span>
          <StatusBadge status={d.displayStatus} />
          <TriageBadge level={i.triage.level} full />
          {d.mission ? <span className="font-mono text-sm font-bold text-forming">{d.mission.code}</span> : null}
        </div>
        <h1 className="mt-1 text-xl font-bold text-ink">{i.assessment.summary}</h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4" aria-hidden /> {i.locationLabel} · {i.assessment.peopleAffected} affected · reported {timeAgo(i.createdAt)}
        </p>
        <div className="mt-2">
          <HazardSummary incident={i} />
        </div>
      </header>

      <CoordinatorOnlyNotice what="Assembling, dispatching and clearing hazards" />
      {handle.error ? <Callout tone="danger" title={handle.error} /> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <NeedsPanel detail={d} handle={handle} canAct={canAct} />
          <InterpretationPanel incident={i} />
          <TriagePanel incident={i} handle={handle} canAct={canAct} />
          <RequirementsPanel incident={i} handle={handle} canEdit={canAct} />
        </div>
        <div className="min-w-0 space-y-3">
          <TeamPanel detail={d} handle={handle} canAct={canAct} />
          <MissionPanel detail={d} handle={handle} />
          <IncidentEvidence detail={d} canAct={canAct} />
          <CandidatesPanel detail={d} handle={handle} canAct={canAct} />
          <TimelinePanel incident={i} />
        </div>
      </div>
    </div>
  );
}
