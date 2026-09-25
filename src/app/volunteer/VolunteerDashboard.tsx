"use client";

import { Award, CheckCircle2, EyeOff, GraduationCap, HandHelping, MapPin, ShieldCheck, Truck, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { MissionStatusBadge, PriorityBadge } from "@/components/badges";
import { useModeHref, useSystem } from "@/components/SystemProvider";
import { Button, Callout, Card, CardHeader, Empty, Pill } from "@/components/ui";
import { RegisterVolunteer } from "@/components/volunteer/RegisterVolunteer";
import { useVolunteerSubject, VolunteerPicker } from "@/components/volunteer/VolunteerPicker";
import { ASSET_LABELS, CREDENTIAL_LABELS, ROLE_LABELS, SKILL_LABELS, TRAINING_LABELS } from "@/domain/catalog";
import type { VolunteerView } from "@/domain/dto";
import type { AvailabilityStatus } from "@/domain/types";
import { READINESS_LEVELS } from "@/engine/readiness";
import { HoldBlock, RouteSummary } from "@/components/ops/OpsPanels";
import { api, notifyChanged, useApi, useOnChanged } from "@/lib/api";
import { cn, timeAgo } from "@/lib/format";

export default function VolunteerDashboard() {
  const mh = useModeHref();
  const sys = useSystem();
  const subject = useVolunteerSubject();
  const q = useApi<VolunteerView>(subject ? `/api/responders/${subject}` : null, { pollMs: 5000 });
  useOnChanged(useCallback(() => void q.refresh(), [q.refresh])); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const isSelf = sys.persona.kind === "responder" && sys.persona.id === subject;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await q.refresh();
      notifyChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const v = q.data;
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Volunteer dashboard</h1>
          <p className="text-muted">You only ever see requests you are qualified and cleared to help with.</p>
        </div>
        <VolunteerPicker />
      </div>
      {!subject ? (
        <>
          {sys.persona.kind === "coordinator" ? (
            <Callout tone="info">
              You are signed in as the coordinator. Review and verify registered volunteers on{" "}
              <Link className="font-semibold underline" href={mh("/preparedness")}>
                Preparedness
              </Link>{" "}
              and{" "}
              <Link className="font-semibold underline" href={mh("/resources")}>
                Resources
              </Link>
              .
            </Callout>
          ) : null}
          <RegisterVolunteer />
        </>
      ) : null}
      {subject && !isSelf ? (
        <Callout tone="info">
          Showing <strong>{v?.responder.name ?? "Jordan Reyes"}</strong> read-only. Choose a volunteer above to act as them (simulated sign-in).
        </Callout>
      ) : null}
      {error ? <Callout tone="danger" title={error} /> : null}
      {!subject ? null : !v ? (
        <Card className="p-8 text-center text-muted">{q.error ?? "Loading…"}</Card>
      ) : (
        <>
          {/* Profile */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-forming text-lg font-bold text-white" aria-hidden>
                {v.responder.name.split(" ").map((x) => x[0]).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-ink">{v.responder.name}</h2>
                <p className="text-sm text-muted">
                  {v.responder.headline} · {ROLE_LABELS[v.responder.role]} · <MapPin className="inline h-3.5 w-3.5" /> {v.responder.locality} · travels up to {v.responder.maxTravelKm} km
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill className={v.responder.identityVerified ? "bg-done-soft text-done" : "bg-life-soft text-life"}>
                    <ShieldCheck className="h-3.5 w-3.5" /> {v.responder.identityVerified ? "Identity verified" : "Identity not verified"}
                  </Pill>
                  <Pill className="bg-forming-soft text-forming">
                    <Award className="h-3.5 w-3.5" /> Readiness L{v.readiness.level} — {v.readiness.name}
                  </Pill>
                  <Pill className="bg-slate-100 text-slate-700">
                    {v.responder.stats.missionsCompleted} missions · {v.responder.stats.hoursContributed} h
                  </Pill>
                </div>
              </div>
              <fieldset className="shrink-0">
                <legend className="text-xs font-semibold text-muted">Availability</legend>
                <div className="mt-1 flex overflow-hidden rounded-md ring-1 ring-line">
                  {(["AVAILABLE", "LIMITED", "UNAVAILABLE"] as AvailabilityStatus[]).map((s) => (
                    <button
                      key={s}
                      disabled={!isSelf || busy !== null}
                      aria-pressed={v.responder.availability.status === s}
                      onClick={() => void act("avail", () => api(`/api/responders/${subject}`, { body: { action: "availability", status: s } }))}
                      className={cn(
                        "px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed",
                        v.responder.availability.status === s ? (s === "AVAILABLE" ? "bg-done text-white" : s === "LIMITED" ? "bg-trained text-white" : "bg-slate-600 text-white") : "bg-white text-ink hover:bg-slate-50",
                      )}
                    >
                      {s === "AVAILABLE" ? "Available" : s === "LIMITED" ? "Limited" : "Off duty"}
                    </button>
                  ))}
                </div>
                {v.responder.availability.note ? <p className="mt-1 text-xs text-muted">{v.responder.availability.note}</p> : null}
              </fieldset>
            </div>
            <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Readiness ladder">
              {READINESS_LEVELS.map((l) => (
                <li key={l.level} className={cn("rounded px-2 py-1.5 text-center text-[11px]", l.level <= v.readiness.level ? "bg-forming text-white" : "bg-slate-100 text-muted")} title={l.description}>
                  <div className="font-bold">L{l.level}</div>
                  <div className="truncate">{l.name}</div>
                </li>
              ))}
            </ol>
            {v.readiness.next ? <p className="mt-1 text-xs text-muted">Next level: {v.readiness.next}</p> : null}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
            {/* Active mission */}
            <Card aria-labelledby="active-h">
              <CardHeader id="active-h" icon={<Truck className="h-4 w-4 text-active" />} title="Active mission" />
              {v.activeMission ? (
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge level={v.activeMission.incident.priority} />
                    <span className="font-bold">
                      {v.activeMission.mission.code} — {v.activeMission.mission.title}
                    </span>
                    <MissionStatusBadge status={v.activeMission.mission.status} />
                  </div>
                  <p className="text-sm">
                    Your role: <strong>{v.activeMission.role}</strong> · {v.activeMission.incident.locationLabel}
                  </p>
                  {v.activeMission.teammates.length ? (
                    <p className="text-sm text-muted">With: {v.activeMission.teammates.map((t) => `${t.name} (${t.role.toLowerCase()})`).join(", ")}</p>
                  ) : null}
                  {v.activeMission.mission.hold ? (
                    <HoldBlock hold={v.activeMission.mission.hold} code={v.activeMission.mission.code} canResume={false} />
                  ) : null}
                  {v.activeMission.mission.route && v.activeMission.mission.status !== "IN_PROGRESS" ? (
                    <RouteSummary route={v.activeMission.mission.route} previous={v.activeMission.mission.routeHistory?.at(-1)} highlight={v.activeMission.mission.status === "REROUTING"}>
                      {v.activeMission.mission.status === "REROUTING" && isSelf ? (
                        <Button size="sm" className="mt-1.5" busy={busy === "ack-route"} onClick={() => void act("ack-route", () => api(`/api/missions/${v.activeMission!.mission.id}`, { body: { action: "ack-route" } }))}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Got it — following the new route
                        </Button>
                      ) : null}
                    </RouteSummary>
                  ) : null}
                  {v.activeMission.briefing ? <p className="max-h-56 overflow-y-auto whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm">{v.activeMission.briefing}</p> : null}
                  {isSelf && v.activeMission.mission.status !== "ON_HOLD" ? (
                    <div className="space-y-2">
                      {v.activeMission.mission.status === "DISPATCHED" || v.activeMission.mission.status === "REROUTING" ? (
                        <Button variant="secondary" busy={busy === "start"} onClick={() => void act("start", () => api(`/api/missions/${v.activeMission!.mission.id}`, { body: { action: "start" } }))}>
                          I&apos;m on scene
                        </Button>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the team complete?" className="min-w-[12rem] flex-1 rounded border border-line px-2 py-1.5 text-sm" aria-label="Completion note" />
                        <Button variant="success" busy={busy === "complete"} onClick={() => void act("complete", () => api(`/api/missions/${v.activeMission!.mission.id}`, { body: { action: "complete", note } }))}>
                          <CheckCircle2 className="h-4 w-4" /> Mark complete
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : v.proposedMissions.length ? (
                <div className="p-4 text-sm">
                  {v.proposedMissions.map((p) => (
                    <p key={p.mission.id}>
                      Proposed for <strong>{p.mission.code}</strong> ({p.role}) — waiting for coordinator dispatch.
                    </p>
                  ))}
                </div>
              ) : (
                <Empty>No active mission.</Empty>
              )}
            </Card>

            {/* Eligible */}
            <Card aria-labelledby="elig-h">
              <CardHeader
                id="elig-h"
                icon={<HandHelping className="h-4 w-4 text-brand" />}
                title="Requests you're eligible for"
                subtitle="Filtered by every hard gate: identity, availability, skill, verified credentials, training, range."
              />
              {v.eligible.length ? (
                <ul className="divide-y divide-line">
                  {v.eligible.slice(0, 8).map((e) => (
                    <li key={e.incident.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <PriorityBadge level={e.incident.priority} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{e.incident.summary}</div>
                        <div className="text-xs text-muted">
                          {e.roles.join(", ")} · {e.distanceKm} km · {e.incident.locationLabel} · {timeAgo(e.incident.createdAt)}
                        </div>
                      </div>
                      {e.offered ? (
                        <Pill className="bg-active-soft text-active">Offered</Pill>
                      ) : isSelf ? (
                        <Button size="sm" variant="secondary" busy={busy === e.incident.id} onClick={() => void act(e.incident.id, () => api(`/api/incidents/${e.incident.id}`, { body: { action: "offer" } }))}>
                          Offer to help
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{v.activeMission ? "You're deployed — new requests appear when you're released." : "No open requests match your verified capabilities right now."}</Empty>
              )}
              <div className="space-y-2 border-t border-line bg-slate-50 px-4 py-2.5 text-xs text-muted">
                <p className="flex items-center gap-1.5">
                  <EyeOff className="h-3.5 w-3.5" /> {v.hiddenCount} other open request(s) hidden — you are not eligible for them.
                </p>
                {v.unlocks.length ? (
                  <p>
                    Would unlock more: {v.unlocks.map((u) => `${u.credential} (${u.incidents})`).join(", ")} —{" "}
                    <Link href={mh("/preparedness")} className="font-semibold text-brand underline">
                      preparedness
                    </Link>
                  </p>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card aria-labelledby="skills-h">
              <CardHeader id="skills-h" icon={<Wrench className="h-4 w-4 text-muted" />} title="Skills & equipment" />
              <div className="space-y-3 p-4 text-sm">
                <div className="flex flex-wrap gap-1">
                  {v.responder.skills.map((s) => (
                    <Pill key={s} className="bg-slate-100 text-slate-800 ring-1 ring-slate-200">
                      {SKILL_LABELS[s]}
                    </Pill>
                  ))}
                </div>
                {v.responder.assets.length ? (
                  <ul className="space-y-1">
                    {v.responder.assets.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span>{a.label}</span>
                        <span className="text-muted">{a.quantity > 1 ? `× ${a.quantity}` : ASSET_LABELS[a.type]}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No equipment registered.</p>
                )}
                <p className="text-xs text-muted">Languages: {v.responder.languages.join(", ").toUpperCase()}</p>
              </div>
            </Card>
            <Card aria-labelledby="creds-h">
              <CardHeader id="creds-h" icon={<ShieldCheck className="h-4 w-4 text-trained" />} title="Verified credentials" subtitle="External records — CoORDINATE verifies, never issues." />
              <ul className="divide-y divide-line text-sm">
                {v.responder.credentials.map((c) => {
                  const expired = c.status === "VERIFIED" && c.expiresAt && new Date(c.expiresAt) < new Date();
                  return (
                    <li key={c.type} className="px-4 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{CREDENTIAL_LABELS[c.type]}</span>
                        <Pill className={expired ? "bg-life-soft text-life" : c.status === "VERIFIED" ? "bg-done-soft text-done" : "bg-trained-soft text-trained"}>{expired ? "expired" : c.status.toLowerCase()}</Pill>
                      </div>
                      <div className="text-xs text-muted">
                        {c.issuer}
                        {c.expiresAt ? ` · expires ${c.expiresAt.slice(0, 10)}` : ""}
                      </div>
                    </li>
                  );
                })}
                {!v.responder.credentials.length ? <li className="px-4 py-3 text-muted">None on file.</li> : null}
              </ul>
            </Card>
            <Card aria-labelledby="done-h">
              <CardHeader id="done-h" icon={<GraduationCap className="h-4 w-4 text-forming" />} title="Training & completed missions" />
              <div className="space-y-3 p-4 text-sm">
                <div className="flex flex-wrap gap-1">
                  {v.responder.training.map((t) => (
                    <Pill key={t.moduleId} className="bg-general-soft text-general">
                      <Award className="h-3 w-3" /> {TRAINING_LABELS[t.moduleId].title}
                    </Pill>
                  ))}
                </div>
                {v.completed.length ? (
                  <ul className="space-y-1">
                    {v.completed.map((c) => (
                      <li key={c.mission.id} className="flex justify-between gap-2">
                        <span>
                          {c.mission.code} — {c.mission.title}
                        </span>
                        <MissionStatusBadge status={c.mission.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No missions in this operation yet.</p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
