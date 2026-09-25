"use client";

import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  Cpu,
  HardHat,
  Home,
  PlayCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Timer,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PriorityBadge, StatusBadge, TriageBadge } from "@/components/badges";
import { IntakeForm } from "@/components/IntakeForm";
import { CandidateMap, CandidatesPanel, DispatchControls, MissionStepper, NearestRejectionCallout, TeamPanel } from "@/components/incident/match";
import { HandoffList, RequirementsPanel } from "@/components/incident/panels";
import { NavigatorResult, NeedsPanel } from "@/components/navigator/Navigator";
import { useIncident, type IncidentHandle } from "@/components/incident/useIncident";
import { useSystem, useModeHref } from "@/components/SystemProvider";
import { Button, Callout, Card, CardHeader, Pill, Stat } from "@/components/ui";
import { OpsMap } from "@/components/Map";
import { EvidenceList, IncidentEvidence, opsMapLayers, RouteSummary, VerificationBadge } from "@/components/ops/OpsPanels";
import type { IncidentDetail, Kpis, OpsView, ReassessChange, Snapshot } from "@/domain/dto";
import { api, ApiError, notifyChanged, useApi, useOnChanged } from "@/lib/api";
import { cn } from "@/lib/format";
import { NeedsByPath } from "@/components/navigator/NeedsByPath";
import { EXAMPLES } from "@/lib/examples";
import { slotIsOptional } from "@/domain/slots";

type Persona = "resident" | "coordinator" | "r-jordan";

const STEPS: { title: string; short: string; persona: Persona; ai: string; rules: string }[] = [
  {
    title: "A resident asks for help",
    short: "Ask",
    persona: "resident",
    ai: "Nothing yet.",
    rules: "Only the words and a location are required. Checking “immediate danger” forces a life-safety escalation.",
  },
  {
    title: "The navigator answers — safety first, trusted help, a choice",
    short: "Navigate",
    persona: "resident",
    ai: "Azure AI Foundry (or the local fallback) extracts every need in the message and quotes the words that support each one. Quotes not found in the text are discarded.",
    rules: "Safety triage runs first. Navigator rules N-01…N-15 give each need a resolution path; the Trusted Assistance Directory supplies services with sources; eligibility (e.g. no federal declaration yet) is checked deterministically. Community help is offered, not imposed.",
  },
  {
    title: "The requested need becomes a mission",
    short: "Need → mission",
    persona: "coordinator",
    ai: "None.",
    rules: "Only the needs the resident requested become capability requirements (N-15). Referrals and handoffs stay where they are. Credential rules set the response class.",
  },
  {
    title: "The capability engine forms a qualified team",
    short: "Team",
    persona: "coordinator",
    ai: "None.",
    rules: "Nine pass/fail gates per candidate (identity, credentials, training, equipment, range…). Only eligible candidates are scored; scarcest roles are filled first.",
  },
  {
    title: "A coordinator dispatches",
    short: "Dispatch",
    persona: "coordinator",
    ai: "Drafts the team briefing (a language task). Safety lines are always deterministic.",
    rules: "The dispatch gate re-runs triage and re-checks every credential and deployment, requires a route around known closures and no weather hold at the site. Only a human dispatches.",
  },
  {
    title: "Live traffic closes the route — the team reroutes",
    short: "Reroute",
    persona: "coordinator",
    ai: "None. A camera's AI observation is evidence, never a decision.",
    rules: "Camera AI alone is never acted on (A3); an official VDOT closure is (A1). Active missions are re-checked and re-planned around the closure (R-01). Routes are never called “safe”.",
  },
  {
    title: "Severe weather holds other missions",
    short: "Weather",
    persona: "coordinator",
    ai: "None. Holds are rules, not model output.",
    rules: "A tornado-warning polygon over a mission holds it (W-01). Resume stays locked until the warning ends (H-01).",
  },
  {
    title: "“There is a sparking power line.”",
    short: "Power line",
    persona: "coordinator",
    ai: "Drafts the handoff summary for the utility and 911 on request — a language task, checked against the wording policy.",
    rules: "Hazard rule R-H04 and navigator rules N-02/N-03: professional response required, no community mission created. WHY / WHO / WHAT is prepared; a person makes the call.",
  },
  {
    title: "The volunteer finishes — the need is resolved",
    short: "Resolve",
    persona: "r-jordan",
    ai: "None.",
    rules: "Only assigned team members can update the mission. The resident confirms; the community need becomes RESOLVED and the team is released.",
  },
  {
    title: "Community impact",
    short: "Impact",
    persona: "coordinator",
    ai: "Optional SITREP drafting on the dashboard.",
    rules: "KPIs come from verified missions and resolved needs — many needs are handled without dispatching anyone.",
  },
];

async function switchPersona(p: Persona) {
  await api("/api/persona", { body: { persona: p } });
}

export default function GuidedDemo() {
  const router = useRouter();
  const sys = useSystem();
  const [step, setStep] = useState(-1);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Kpis | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const h = useIncident(incidentId, 4000);
  const d = h.data;

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const go = async (next: number) => {
    const target = STEPS[next]?.persona;
    // Always set the step's persona on the server. The persona shown on the page can be stale
    // (Restart signs the sandbox back in as coordinator), and skipping the switch would, e.g.,
    // file Denise's request as the coordinator so she could not confirm the work later.
    if (target) {
      await switchPersona(target);
      router.refresh();
      // What a persona may see differs (e.g. handoff summaries are coordinator-only): reload the incident.
      notifyChanged();
    }
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const start = async () => {
    setBusy(true);
    try {
      // Stop polling the previous run's incident before the sandbox is wiped.
      setIncidentId(null);
      await api("/api/demo/reset", { body: {} });
      const snap = await api<Snapshot>("/api/snapshot");
      setBaseline(snap.kpis);
      setStartedAt(Date.now());
      notifyChanged();
      await go(0);
    } finally {
      setBusy(false);
    }
  };

  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const escalated = d ? !d.incident.triage.civilianDispatchAllowed : false;

  if (step < 0) return <Intro onStart={() => void start()} busy={busy} />;
  const meta = STEPS[step];

  return (
    <div className="mx-auto max-w-[1500px] px-3 py-3 sm:px-4">
      {/* Stepper */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-ink">Guided demo</h1>
        <ol className="flex flex-1 flex-wrap items-center gap-1" aria-label="Demo steps">
          {STEPS.map((s, i) => (
            <li key={s.short} aria-current={i === step ? "step" : undefined}>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                  i === step ? "bg-ink text-white" : i < step ? "bg-done-soft text-done" : "bg-white text-muted ring-1 ring-line",
                )}
              >
                {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
                {s.short}
              </span>
            </li>
          ))}
        </ol>
        <span className={cn("inline-flex items-center gap-1 font-mono text-sm font-semibold", elapsed > 180 ? "text-pro" : "text-muted")} title="Target: under 3 minutes">
          <Timer className="h-4 w-4" /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void start()} busy={busy}>
          <RotateCcw className="h-3.5 w-3.5" /> Restart
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg bg-ink px-4 py-3 text-white">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#7cc4ff]">
              Step {step + 1} of {STEPS.length} · acting as {meta.persona === "resident" ? "the resident" : meta.persona === "coordinator" ? "the EOC coordinator" : "Jordan (volunteer)"}
            </div>
            <h2 className="text-xl font-bold">{meta.title}</h2>
          </div>

          {step === 0 ? (
            <Card className="p-4 sm:p-5">
              <IntakeForm
                key="demo-intake"
                initial={EXAMPLES[0].values}
                examples={[EXAMPLES[0], EXAMPLES[2]]}
                submitLabel="Get guidance"
                onSubmitted={(i) => {
                  setIncidentId(i.id);
                  notifyChanged();
                  void go(1);
                }}
              />
            </Card>
          ) : !d ? (
            <Card className="p-8 text-center text-muted">Loading…</Card>
          ) : (
            <StepBody step={step} d={d} h={h} go={go} escalated={escalated} baseline={baseline} restart={() => void start()} />
          )}
        </div>

        <aside className="space-y-3" aria-label="What is happening">
          <Card className="p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Who decides this step?</h3>
            <div className="space-y-2 text-sm">
              <div className="rounded-md bg-brand-soft p-2.5">
                <div className="flex items-center gap-1.5 font-semibold text-brand">
                  <Sparkles className="h-4 w-4" /> AI
                </div>
                <p className="mt-0.5 text-ink">{meta.ai}</p>
              </div>
              <div className="rounded-md bg-slate-100 p-2.5">
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  <ShieldCheck className="h-4 w-4" /> Deterministic rules
                </div>
                <p className="mt-0.5 text-ink">{meta.rules}</p>
              </div>
            </div>
          </Card>
          {d ? (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
                <PriorityBadge level={d.incident.priority.level} />
                <span className="font-mono text-xs font-bold text-muted">{d.incident.number}</span>
                <StatusBadge status={d.displayStatus} />
                {d.mission ? <Pill className="bg-forming-soft text-forming">{d.mission.code}</Pill> : null}
              </div>
              {step === 5 || step === 6 ? (
                <DemoOpsMap missionId={d.mission?.id} incidentId={d.incident.id} weather={step === 6} />
              ) : step >= 3 ? (
                <CandidateMap detail={d} height="h-56" />
              ) : (
                <div className="p-3 text-sm text-ink">{d.incident.assessment.summary}</div>
              )}
            </Card>
          ) : null}
          <Card className="p-4 text-sm">
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              <Cpu className="h-4 w-4" /> Running on
            </div>
            <ul className="mt-1 space-y-0.5 text-muted">
              <li>AI: {sys.ai.provider === "azure-ai-foundry" ? `Azure AI Foundry (${sys.ai.model})` : "local rules interpreter"}</li>
              <li>Data: {sys.data === "cosmos" ? "Azure Cosmos DB" : "in-memory store"}</li>
              <li>Maps: {sys.maps === "azure-maps" ? "Azure Maps" : "OpenStreetMap fallback"}</li>
            </ul>
            <p className="mt-2 text-xs text-muted">Your own sandbox — nothing you do here affects other visitors.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Nav({ back, next, nextLabel, busy, disabled }: { back?: () => void; next?: () => void; nextLabel?: string; busy?: boolean; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {back ? (
        <Button variant="ghost" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button size="lg" onClick={next} busy={busy} disabled={disabled}>
          {nextLabel ?? "Next"} <ArrowRight className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function StepBody({
  step,
  d,
  h,
  go,
  escalated,
  baseline,
  restart,
}: {
  step: number;
  d: IncidentDetail;
  h: IncidentHandle;
  go: (n: number) => Promise<void>;
  escalated: boolean;
  baseline: Kpis | null;
  restart: () => void;
}) {
  const i = d.incident;
  const m = d.mission;
  const [working, setWorking] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };

  switch (step) {
    case 1:
      return (
        <>
          <NavigatorResult detail={d} handle={h} canRequest />
          {h.error ? <Callout tone="danger" title={h.error} /> : null}
          {escalated ? (
            <Button onClick={restart}>
              <RotateCcw className="h-4 w-4" /> Restart with the community-help example
            </Button>
          ) : null}
          <Nav
            back={() => void go(0)}
            next={() => void go(2)}
            nextLabel="See it as the coordinator"
            disabled={!i.needs.some((n) => n.status === "HELP_REQUESTED" || n.status === "MISSION_ACTIVE") && !escalated}
          />
        </>
      );
    case 2:
      return (
        <>
          <NeedsPanel detail={d} handle={h} canAct />
          <RequirementsPanel incident={i} handle={h} canEdit />
          <Nav
            back={() => void go(1)}
            next={() =>
              void act(async () => {
                if (!m || m.status === "CANCELLED") await h.incidentAction({ action: "propose" });
                await go(3);
              })
            }
            busy={working || h.busy === "propose"}
            nextLabel="Form the team"
            disabled={i.requirements.length === 0 || escalated}
          />
        </>
      );
    case 3:
      return (
        <>
          <NearestRejectionCallout detail={d} />
          <TeamPanel detail={d} handle={h} canAct />
          <details className="rounded-md border border-line bg-white p-2 text-sm">
            <summary className="cursor-pointer font-semibold text-ink">Every candidate, every gate — pick team members yourself</summary>
            <div className="mt-2">
              <CandidatesPanel detail={d} handle={h} canAct compact />
            </div>
          </details>
          <Nav back={() => void go(2)} next={() => void go(4)} nextLabel="Review & dispatch" disabled={!m} />
        </>
      );
    case 4:
      return (
        <>
          <DispatchStep d={d} h={h} />
          <Nav back={() => void go(3)} next={() => void go(5)} nextLabel="Conditions change" disabled={!m || m.status === "PROPOSED"} />
        </>
      );
    case 5:
      return (
        <>
          <RerouteStep d={d} />
          <Nav back={() => void go(4)} next={() => void go(6)} nextLabel="Severe weather arrives" disabled={!m?.routeHistory?.length} />
        </>
      );
    case 6:
      return (
        <>
          <WeatherStep />
          <Nav back={() => void go(5)} next={() => void go(7)} nextLabel="Another resident writes in" />
        </>
      );
    case 7:
      return (
        <>
          <PowerLineStep />
          <Nav back={() => void go(6)} next={() => void go(8)} nextLabel="Switch to Jordan's phone" />
        </>
      );
    case 8:
      return (
        <>
          <VolunteerStep d={d} h={h} />
          <Nav back={() => void go(7)} next={() => void go(9)} nextLabel="See community impact" disabled={m?.status !== "VERIFIED"} />
        </>
      );
    case 9:
      return <ImpactStep d={d} baseline={baseline} />;
    default:
      return null;
  }
}

const POWER_LINE_TEXT = "There is a sparking power line.";

/** The other half of the navigator: a need that must never become a community mission. */
function PowerLineStep() {
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = useIncident(id, 0);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api<{ incident: { id: string } }>("/api/incidents", { body: { text: POWER_LINE_TEXT, locationText: "Wasena, Roanoke", peopleAffected: 2, reporterRelation: "SELF" } });
      setId(res.incident.id);
      notifyChanged();
    } finally {
      setBusy(false);
    }
  };
  if (!id)
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">A second resident, in Wasena, types one sentence:</p>
        <blockquote className="mt-2 rounded-md border-l-4 border-life bg-life-soft px-3 py-2 text-lg font-semibold text-ink">“{POWER_LINE_TEXT}”</blockquote>
        <Button className="mt-3" size="lg" variant="danger" busy={busy} onClick={() => void submit()}>
          <Send className="h-4 w-4" /> Submit it
        </Button>
      </Card>
    );
  if (!p.data) return <Card className="p-8 text-center text-muted">Understanding the situation…</Card>;
  const d = p.data;
  return (
    <div className="space-y-3">
      <Card className="border-life p-4">
        <div className="flex flex-wrap items-center gap-2">
          <TriageBadge level={d.incident.triage.level} full />
          <StatusBadge status={d.displayStatus} />
          <span className="text-sm font-semibold text-ink">{d.mission ? `Mission ${d.mission.code}` : "No community mission created"}</span>
        </div>
        <p className="mt-2 text-xl font-bold text-life">Professional emergency response required. No community mission created.</p>
        <ul className="mt-1 space-y-0.5 text-sm">
          {d.navigator.immediatePriority.map((l) => (
            <li key={l}>• {l}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Handoffs — why, who, what" subtitle="CoORDINATE prepares them. A coordinator makes the call and records it; nothing is sent automatically." />
        <div className="p-4">
          <HandoffList incident={d.incident} handle={p} canAct />
        </div>
      </Card>
    </div>
  );
}

function DispatchStep({ d, h }: { d: IncidentDetail; h: IncidentHandle }) {
  const m = d.mission!;
  const checks = m.status === "PROPOSED" ? d.dispatchPreview?.checks : m.dispatchChecks;
  return (
    <Card>
      <CardHeader icon={<Send className="h-4 w-4 text-active" />} title={`${m.code} — ${m.title}`} subtitle="The dispatch gate re-validates everything at the moment of dispatch." />
      <div className="space-y-4 p-4">
        <MissionStepper mission={m} />
        <ul className="space-y-1">
          {checks?.map((c) => (
            <li key={c.id} className={cn("flex gap-2 rounded px-2 py-1.5 text-sm", c.passed ? "bg-done-soft/70" : c.acknowledgeable ? "bg-trained-soft" : "bg-life-soft")}>
              {c.passed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" /> : <span className={cn("mt-0.5 h-4 w-4 shrink-0", c.acknowledgeable ? "font-bold text-trained" : "text-life")}>{c.acknowledgeable ? "!" : "✕"}</span>}
              <span>
                <span className="font-semibold">{c.label}</span> — {c.detail}
              </span>
            </li>
          ))}
        </ul>
        {h.error ? <Callout tone="danger" title={h.error} /> : null}
        {m.status === "PROPOSED" && d.incident.advisories.some((a) => a.requiresAcknowledgement && !a.acknowledgedAt) ? (
          <Callout tone="warn" title="A safety advisory needs the coordinator's confirmation before dispatch">
            {d.incident.advisories
              .filter((a) => a.requiresAcknowledgement && !a.acknowledgedAt)
              .map((a) => (
                <div key={a.id} className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{a.message}</span>
                  <Button size="sm" variant="secondary" busy={h.busy === "ack-advisory"} onClick={() => void h.incidentAction({ action: "ack-advisory", advisoryId: a.id })}>
                    I confirmed this with the resident
                  </Button>
                </div>
              ))}
          </Callout>
        ) : null}
        {m.status === "PROPOSED" && m.unfilledSlotIds.some((id) => { const r = d.incident.requirements.find((x) => x.id === id); return !r || !slotIsOptional(r); }) ? (
          <Callout tone="warn" title="An essential role has no eligible resource — dispatch stays blocked">
            In a real operation the coordinator would request mutual aid or recruit through a partner. Restart and use the pre-filled example to see a complete team.
          </Callout>
        ) : null}
        {m.status === "PROPOSED" ? (
          <DispatchControls detail={d} handle={h} label={`Dispatch ${m.code} as coordinator`} />
        ) : (
          <div className="space-y-2">
            <Callout tone="success" title={`${m.code} dispatched — team notification simulated (no SMS/push provider)`} icon={<CheckCircle2 className="h-5 w-5 text-done" />}>
              {m.route ? `Route planned for ${m.route.origin.label}: ${m.route.roads.join(" → ")} · ${m.route.etaMinutes} min. ${m.route.statement}` : null}
            </Callout>
            <details className="rounded-md border border-line p-2 text-sm">
              <summary className="cursor-pointer font-semibold text-forming">Optional: confirm driveway access with the resident&apos;s opt-in camera</summary>
              <div className="mt-2">
                <IncidentEvidence detail={d} canAct />
              </div>
            </details>
            {m.briefing ? (
              <div className="rounded-md border border-line bg-slate-50 p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-muted">
                  Team briefing · {m.briefing.provider === "azure-ai-foundry" ? `drafted by Azure AI Foundry (${m.briefing.model})` : "deterministic template"}
                </div>
                <p className="whitespace-pre-line">{m.briefing.text}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

function VolunteerStep({ d, h }: { d: IncidentDetail; h: IncidentHandle }) {
  const sys = useSystem();
  const router = useRouter();
  const m = d.mission!;
  const jordan = m.assignments.find((a) => a.responderId === "r-jordan");
  const role = jordan ? d.incident.requirements.find((s) => s.id === jordan.slotId)?.label : undefined;
  const verifyAsResident = async () => {
    await switchPersona("resident");
    router.refresh();
    await h.missionAction(m.id, "verify", "Driveway is clear — thank you!");
  };
  return (
    <div className="grid gap-3 md:grid-cols-[320px_1fr]">
      <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border-8 border-ink bg-white p-3 shadow-xl" aria-label="Volunteer phone view">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1">
            <Smartphone className="h-3.5 w-3.5" /> CoORDINATE
          </span>
          <span>{sys.persona.name}</span>
        </div>
        <div className="rounded-lg bg-active px-3 py-2 text-white">
          <div className="text-xs font-semibold uppercase opacity-80">Active mission</div>
          <div className="font-bold">
            {m.code} — {m.title}
          </div>
          <div className="text-xs opacity-90">Your role: {role ?? "team member"}</div>
        </div>
        {m.route && (m.status === "DISPATCHED" || m.status === "REROUTING") ? (
          <div className={cn("mt-2 rounded-md p-2 text-xs", m.status === "REROUTING" ? "bg-trained-soft" : "bg-slate-50")}>
            <div className="font-bold text-ink">
              {m.status === "REROUTING" ? "New route" : "Route"} · {m.route.etaMinutes} min{m.routeHistory?.length ? ` (was ${m.routeHistory.at(-1)!.etaMinutes})` : ""}
            </div>
            <div>{m.route.roads.join(" → ")}</div>
            {m.route.avoided.length ? <div className="text-trained">Avoiding: {m.route.avoided.map((a) => a.title).join("; ")}</div> : null}
            {m.status === "REROUTING" ? (
              <Button size="sm" className="mt-1.5 w-full" busy={h.busy === "ack-route"} onClick={() => void h.missionAction(m.id, "ack-route")}>
                Got it — following the new route
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-ink">{m.briefing?.text}</p>
        <div className="mt-3 space-y-2">
          {m.status === "DISPATCHED" ? (
            <Button className="w-full" variant="secondary" busy={h.busy === "start"} onClick={() => void h.missionAction(m.id, "start")}>
              <Truck className="h-4 w-4" /> I&apos;m on scene
            </Button>
          ) : null}
          {m.status === "DISPATCHED" || m.status === "IN_PROGRESS" || m.status === "REROUTING" ? (
            <Button className="w-full" variant="success" busy={h.busy === "complete"} onClick={() => void h.missionAction(m.id, "complete", "Tree cut and hauled away; driveway is open and accessible.")}>
              <CheckCircle2 className="h-4 w-4" /> Mark mission complete
            </Button>
          ) : null}
          {m.status === "COMPLETED" || m.status === "VERIFIED" ? (
            <div className="rounded-md bg-done-soft px-3 py-2 text-center text-sm font-semibold text-done">Completed — thank you, Jordan!</div>
          ) : null}
        </div>
      </div>
      <Card className="p-4">
        <MissionStepper mission={m} />
        <div className="mt-4 space-y-3 text-sm">
          <p>
            Jordan sees only missions they are eligible for. As an assigned team member they can check in and mark the mission complete — they cannot dispatch or verify their own work.
          </p>
          {m.status === "COMPLETED" ? (
            <Callout tone="success" title="Team reports complete — now the resident confirms">
              <p>“{m.completionNote}”</p>
              <Button className="mt-2" variant="success" busy={h.busy === "verify"} onClick={() => void verifyAsResident()}>
                <BadgeCheck className="h-4 w-4" /> Confirm as Denise (resident)
              </Button>
            </Callout>
          ) : null}
          {m.status === "VERIFIED" ? <Callout tone="success" title={`Verified by ${m.verification?.by}. Incident resolved.`} /> : null}
          {h.error ? <Callout tone="danger" title={h.error} /> : null}
        </div>
      </Card>
    </div>
  );
}

function ImpactStep({ d, baseline }: { d: IncidentDetail; baseline: Kpis | null }) {
  const mh = useModeHref();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    void api<Snapshot>("/api/snapshot").then(setSnap);
  }, []);
  const k = snap?.kpis;
  const delta = (a?: number, b?: number | null) => (a !== undefined && b !== undefined && b !== null && a !== b ? `${a - b > 0 ? "+" : ""}${Math.round((a - b) * 10) / 10}` : undefined);
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-done" />
          <h3 className="text-lg font-bold text-ink">
            {d.incident.number} resolved — {d.mission?.code} verified
          </h3>
          <StatusBadge status={d.displayStatus} />
          <TriageBadge level={d.incident.triage.level} />
        </div>
        <p className="mt-1 text-sm text-muted">
          From a free-text request to a verified, credentialed response — with every AI proposal, rule decision and human action in the audit timeline.
        </p>
      </Card>
      {k ? (
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="People helped" value={k.peopleHelped} hint={delta(k.peopleHelped, baseline?.peopleHelped) ? `${delta(k.peopleHelped, baseline?.peopleHelped)} since demo start` : undefined} tone="done" />
          <Stat label="Volunteer hours" value={k.volunteerHours} hint={`≈ $${k.estimatedValueUsd.toLocaleString()} donated value`} />
          <Stat label="Volunteers ready" value={k.volunteersReady} hint="team released back to the pool" tone="active" />
          <Stat label="Avg. request → dispatch" value={k.avgMinutesToDispatch !== null ? `${k.avgMinutesToDispatch} min` : "—"} tone="brand" />
        </Card>
      ) : null}
      {k ? <NeedsByPath kpis={k} /> : null}
      <CandidateMap detail={d} height="h-72" />
      <div className="flex flex-wrap gap-2">
        <Link href={mh("/ops")} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark">
          <Home className="h-4 w-4" /> Open the operations dashboard
        </Link>
        <Link href={mh(`/ops/incidents/${d.incident.id}`)} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2.5 font-semibold hover:bg-slate-50">
          Full audit trail
        </Link>
        <Link href={mh("/volunteer")} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2.5 font-semibold hover:bg-slate-50">
          <HardHat className="h-4 w-4" /> Volunteer view
        </Link>
        <Link href="/how-it-works" className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2.5 font-semibold hover:bg-slate-50">
          How the rules work
        </Link>
      </div>
    </div>
  );
}

/** The operational picture, refreshed immediately whenever this browser changes something. */
function useOpsView(pollMs: number) {
  const ops = useApi<OpsView>("/api/ops", { pollMs });
  useOnChanged(useCallback(() => void ops.refresh(), [ops.refresh])); // eslint-disable-line react-hooks/exhaustive-deps
  return ops;
}

function useInject() {
  const [busy, setBusy] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, ReassessChange[]>>({});
  const [views, setViews] = useState<Record<string, OpsView>>({});
  const inject = async (id: string) => {
    setBusy(id);
    try {
      const v = await api<OpsView>("/api/ops/scenario", { body: { inject: id } });
      setChanges((c) => ({ ...c, [id]: v.changes ?? [] }));
      setViews((x) => ({ ...x, [id]: v }));
      notifyChanged();
    } finally {
      setBusy(null);
    }
  };
  return { busy, changes, views, inject };
}

function ChangeList({ changes }: { changes?: ReassessChange[] }) {
  if (!changes) return null;
  return changes.length ? (
    <ul className="space-y-1 text-sm">
      {changes.map((c) => (
        <li key={c.missionId + c.status} className="rounded bg-trained-soft px-2 py-1 text-ink">
          {c.message}
        </li>
      ))}
    </ul>
  ) : (
    <p className="rounded bg-slate-100 px-2 py-1 text-sm text-ink">Every active mission re-checked — no change. Nothing acted on this report.</p>
  );
}

function RerouteStep({ d }: { d: IncidentDetail }) {
  const m = d.mission!;
  const inj = useInject();
  const ops = useOpsView(4000);
  const findCam = (v?: OpsView | null) => v?.clusters.find((c) => c.evidence.some((e) => e.eventId.startsWith("ev-cam419-")));
  const cam = findCam(ops.data);
  // Show the camera item as it was when it arrived (before VDOT corroborated it).
  const camAtArrival = findCam(inj.views["camera-obstruction"]) ?? cam;
  const camDone = !!inj.changes["camera-obstruction"] || !!cam;
  const crashDone = !!inj.changes["collision-closure"] || !!m.routeHistory?.length;
  return (
    <Card>
      <CardHeader icon={<Sparkles className="h-4 w-4 text-trained" />} title={`${m.code} is on the road — the picture changes`} subtitle="Simulated feeds for the exercise. The same code handles live NWS, Azure Maps Traffic and VDOT data." />
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="text-sm font-semibold text-ink">1 · A VDOT traffic camera&apos;s AI flags a possible obstruction on Rte 419</div>
          {!camDone ? (
            <Button variant="secondary" busy={inj.busy === "camera-obstruction"} onClick={() => void inj.inject("camera-obstruction")}>
              Inject camera observation
            </Button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/sim/camera-419-blocked.svg" alt="Simulated VDOT camera frame showing a possible obstruction on Rte 419" className="w-full rounded border border-line" />
              <div className="space-y-1.5">
                {camAtArrival ? (
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    <VerificationBadge status={camAtArrival.status} /> <span className="font-semibold">{camAtArrival.title}</span>
                  </div>
                ) : null}
                <ChangeList changes={inj.changes["camera-obstruction"]} />
                <p className="text-xs text-muted">Rule A3: a machine observation alone never closes a road or reroutes anyone. It waits for an independent source.</p>
              </div>
            </div>
          )}
        </div>
        {camDone ? (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="text-sm font-semibold text-ink">2 · Virginia 511 / VDOT reports a crash closing Rte 419</div>
            {!crashDone ? (
              <Button busy={inj.busy === "collision-closure"} onClick={() => void inj.inject("collision-closure")}>
                Inject VDOT closure
              </Button>
            ) : (
              <div className="space-y-2">
                <ChangeList changes={inj.changes["collision-closure"]} />
                {cam ? <EvidenceList items={cam.evidence} /> : null}
                {m.route ? <RouteSummary route={m.route} previous={m.routeHistory?.at(-1)} highlight={m.status === "REROUTING"} /> : null}
                <p className="text-xs text-muted">
                  The official closure is actionable on its own (A1) and the camera now corroborates it. {m.code} was re-planned around it; the team must acknowledge the new route
                  on the next screen.
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function WeatherStep() {
  const inj = useInject();
  const ops = useOpsView(3000);
  const [resumeMsg, setResumeMsg] = useState<string | null>(null);
  const view = ops.data;
  const held = view?.missions.filter((m) => m.hold) ?? [];
  const warned = !!inj.changes["tornado-warning"] || held.length > 0;
  const ended = !!inj.changes["end-warnings"];
  const tryResume = async () => {
    const target = held[0];
    if (!target) return;
    try {
      await api(`/api/missions/${target.id}`, { body: { action: "resume" } });
      setResumeMsg("Resumed.");
    } catch (e) {
      setResumeMsg(e instanceof ApiError ? `Refused: ${e.message}` : "Refused.");
    }
    notifyChanged();
  };
  return (
    <Card>
      <CardHeader icon={<ShieldCheck className="h-4 w-4 text-life" />} title="NWS issues a tornado warning across the river" subtitle="Simulated alert, with an IPAWS copy — the two merge into one condition." />
      <div className="space-y-3 p-4">
        {!warned ? (
          <Button variant="danger" busy={inj.busy === "tornado-warning"} onClick={() => void inj.inject("tornado-warning")}>
            Inject tornado warning (SE Roanoke)
          </Button>
        ) : (
          <>
            <Callout tone="danger" title={`${held.length} mission${held.length === 1 ? "" : "s"} held by rule W-01 — teams told to shelter`}>
              <ul className="mt-1 space-y-1.5">
                {held.map((m) => (
                  <li key={m.id} className="text-sm">
                    <span className="font-mono font-bold">{m.code}</span> {m.title} · {m.locationLabel} ·{" "}
                    <span className={m.hold?.conditionCleared ? "font-semibold text-done" : "font-semibold text-life"}>{m.hold?.conditionCleared ? "condition cleared" : "on hold"}</span>
                    {m.hold?.welfareNote && !m.hold.conditionCleared ? <div className="text-xs font-semibold text-pro">⚠ {m.hold.welfareNote}</div> : null}
                    {m.hold?.conditionCleared ? <ResumeButton missionId={m.id} code={m.code} /> : null}
                  </li>
                ))}
              </ul>
            </Callout>
            {!ended ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" disabled={!held.length} onClick={() => void tryResume()}>
                  Try to resume {held[0]?.code ?? "a held mission"} now
                </Button>
                <Button busy={inj.busy === "end-warnings"} onClick={() => void inj.inject("end-warnings")}>
                  NWS: warning expires
                </Button>
              </div>
            ) : (
              <p className="rounded bg-done-soft px-2 py-1 text-sm text-ink">Warning ended — rule H-01 marked each hold as cleared. A coordinator now decides when each team resumes.</p>
            )}
            {resumeMsg && !ended ? <Callout tone={resumeMsg.startsWith("Refused") ? "danger" : "success"} title={resumeMsg} /> : null}
            <p className="text-xs text-muted">Your mission in Cave Spring is outside the warning polygon, so it continues. Held missions resume only after the rules record that the warning has ended.</p>
          </>
        )}
      </div>
    </Card>
  );
}

function ResumeButton({ missionId, code }: { missionId: string; code: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      className="ml-2"
      busy={busy}
      onClick={() => {
        setBusy(true);
        void api(`/api/missions/${missionId}`, { body: { action: "resume" } })
          .then(() => notifyChanged())
          .finally(() => setBusy(false));
      }}
    >
      Resume {code}
    </Button>
  );
}

function DemoOpsMap({ missionId, incidentId, weather }: { missionId?: string; incidentId: string; weather: boolean }) {
  const ops = useOpsView(4000);
  const view = ops.data;
  const { shapes, markers } = opsMapLayers(view, { hazards: true, unverified: true, routes: true, cameras: !weather }, { missionId });
  const missions = (view?.missions ?? []).filter((m) => (weather ? m.hold || m.id === missionId : m.id === missionId));
  const pins = missions.map((m) => ({
    id: m.incidentId,
    position: m.location,
    kind: "incident" as const,
    color: m.status === "ON_HOLD" ? "#b42318" : "#0f766e",
    glyph: m.code.slice(-3),
    selected: m.incidentId === incidentId,
    label: `${m.code} · ${m.status.toLowerCase().replace(/_/g, " ")}`,
  }));
  return (
    <OpsMap
      markers={[...markers.filter((x) => !weather || x.kind !== "camera"), ...pins]}
      shapes={shapes}
      fit
      fitKey={`${weather}-${pins.length}`}
      className="h-56"
      ariaLabel="Map of conditions, routes and affected missions"
    />
  );
}

function Intro({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <span className="inline-block rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">About 3 minutes · no account · no Azure setup needed</span>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Guided demo: navigate the person → resolve the need → coordinate the response</h1>
      <p className="mt-2 text-lg text-muted">
        You&apos;ll play a resident asking for help, the emergency-operations coordinator and a volunteer. Every step runs on the real API and rule engine — nothing is pre-recorded.
      </p>
      <ol className="mt-6 grid gap-2 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.short} className="flex items-start gap-2 rounded-md border border-line bg-white p-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
            <span className="font-medium text-ink">{s.title}</span>
          </li>
        ))}
      </ol>
      <Card className="mt-6 p-4">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-forming" />
          <p className="text-sm text-ink">
            <strong>Scenario (fictional):</strong> remnants of Tropical Storm Delphine have stalled over the Roanoke Valley. 20 requests are already in the system — some
            dispatched, some escalated to professionals, some answered with guidance and referrals only — and simulated NWS, VDOT, camera and news feeds describe
            conditions on the ground. You will ask for help as a resident, see which needs are resolved by information, referral or a person, request community
            help for one of them, and watch the resulting mission adapt when a road closes and a tornado warning is issued.
          </p>
        </div>
      </Card>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onStart} busy={busy}>
          <PlayCircle className="h-5 w-5" /> Start the demo
        </Button>
        <span className="text-sm text-muted">Starting resets your private sandbox to the seeded scenario.</span>
      </div>
    </div>
  );
}
