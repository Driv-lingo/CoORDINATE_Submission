"use client";

import { BadgeCheck, Check, Info, PauseCircle, Route } from "lucide-react";
import Link from "next/link";
import { useIncident } from "@/components/incident/useIncident";
import { useSystem, useModeHref } from "@/components/SystemProvider";
import { Button, Callout, Card } from "@/components/ui";
import { NavigatorResult } from "@/components/navigator/Navigator";
import { clock, cn } from "@/lib/format";

const STEPS = ["Requested", "Reviewed for safety", "Team assigned", "Help on the way", "Work completed", "Confirmed"];

export default function ResidentStatus({ id }: { id: string }) {
  const mh = useModeHref();
  const sys = useSystem();
  const h = useIncident(id);
  const d = h.data;
  if (!d) return <div className="p-8 text-center text-muted">{h.error ?? "Loading your request…"}</div>;
  const i = d.incident;
  const m = d.mission;
  const escalated = i.triage.level === "LIFE_SAFETY_EMERGENCY" || i.triage.level === "PROFESSIONAL_RESPONSE_REQUIRED";
  const infoOnly = i.triage.level === "INFORMATION_ONLY";
  const step = escalated || infoOnly
    ? 1
    : !m || m.status === "CANCELLED"
      ? 1
      : m.status === "PROPOSED"
        ? 2
        : m.status === "DISPATCHED" || m.status === "REROUTING" || m.status === "ON_HOLD" || m.status === "IN_PROGRESS"
          ? 3
          : m.status === "COMPLETED"
            ? 4
            : 5;

  const requested = !!m || (i.needs ?? []).some((n) => n.status === "HELP_REQUESTED" || n.status === "MISSION_ACTIVE");

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <p className="text-sm text-muted">Request {i.number} · sent {clock(i.createdAt)}</p>
        <h1 className="text-2xl font-bold text-ink">
          {escalated ? "This needs emergency professionals" : infoOnly ? "Thanks — your report was logged" : requested ? "We're coordinating help" : "Here's what to do next"}
        </h1>
      </div>

      {requested && !escalated && !infoOnly ? (
        <Card className="p-4">
          <h2 className="font-semibold text-ink">Your coordinated help</h2>
          {m?.status === "ON_HOLD" ? (
            <Callout tone="warn" title="Your team is paused for safety" icon={<PauseCircle className="h-5 w-5" />}>
              Conditions near you or on their route changed ({m.hold?.reason}). They will continue after the warning or closure ends and a coordinator confirms. If anyone is in danger, call 911.
            </Callout>
          ) : m?.status === "REROUTING" || (m?.route && (m.routeHistory?.length ?? 0) > 0 && m.status === "DISPATCHED") ? (
            <Callout tone="info" title="Your team is taking a different route" icon={<Route className="h-5 w-5" />}>
              A road on their original route is closed. Estimated travel time now about {m?.route?.etaMinutes} minutes.
            </Callout>
          ) : null}
          <ol className="mt-3 space-y-3" aria-label="Request progress">
            {STEPS.map((s, idx) => (
              <li key={s} className="flex items-center gap-3" aria-current={idx === step ? "step" : undefined}>
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold", idx <= step ? "bg-done text-white" : "bg-slate-200 text-slate-500")}>
                  {idx < step || (idx === step && step === 5) ? <Check className="h-4 w-4" /> : idx + 1}
                </span>
                <span className={cn("text-[15px]", idx <= step ? "font-semibold text-ink" : "text-muted")}>{s}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {infoOnly ? (
        <Card className="p-4 text-[15px]">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <Info className="h-5 w-5" aria-hidden /> Logged as a road / area condition report
          </div>
          <p className="mt-1 text-muted">
            You said no help is needed, so no team will be sent. Your report helps coordinators plan routes once another source confirms it. If you do need help, please send a new request describing what you need.
          </p>
        </Card>
      ) : null}

      <NavigatorResult detail={d} handle={h} canRequest={sys.persona.kind === "resident" || sys.persona.kind === "coordinator"} />

      {m && m.status !== "PROPOSED" && m.status !== "CANCELLED" ? (
        <Card className="space-y-2 p-4 text-[15px]">
          <p className="text-sm">
            Your team: <strong>{m.assignments.filter((a, k, arr) => arr.findIndex((x) => x.responderId === a.responderId) === k).map((a) => d.responders[a.responderId]?.name).join(", ")}</strong>. Every volunteer sent to you
            has passed identity and safety checks.
          </p>
        </Card>
      ) : null}

      {m?.status === "COMPLETED" ? (
        <Callout tone="success" title="The team says the work is done">
          <p>“{m.completionNote}”</p>
          {sys.persona.kind === "resident" ? (
            <Button className="mt-2" variant="success" busy={h.busy === "verify"} onClick={() => void h.missionAction(m.id, "verify", "Resident confirmed help received.")}>
              <BadgeCheck className="h-4 w-4" /> Yes, I received the help
            </Button>
          ) : null}
        </Callout>
      ) : null}
      {m?.status === "VERIFIED" ? <Callout tone="success" title="Confirmed complete. Thank you for letting us know." /> : null}

      <p className="text-sm text-muted">
        Coordinator view: <Link className="font-semibold text-brand underline" href={mh(`/ops/incidents/${i.id}`)}>open this incident in the operations workbench</Link>.
      </p>
    </div>
  );
}
