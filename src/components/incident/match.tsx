"use client";

import {
  ArrowRight,
  Ban,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  CircleCheckBig,
  ClipboardCheck,
  Send,
  ShieldCheck,
  Truck,
  User,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { IncidentDetail } from "@/domain/dto";
import { slotIsOptional } from "@/domain/slots";
import type { CandidateEvaluation, GateId, Mission, MissionStatus, RequirementSlot, SlotMatch } from "@/domain/types";
import { clock, cn } from "@/lib/format";
import { OpsMap, type MapLine, type MapMarker, type MapShape } from "../Map";
import { DecisionRecords, HoldBlock, RouteSummary } from "../ops/OpsPanels";
import { MissionStatusBadge } from "../badges";
import { useSystem } from "../SystemProvider";
import { Button, Callout, Card, CardHeader, Pill } from "../ui";
import { SlotRequirementChips } from "./panels";
import type { IncidentHandle } from "./useIncident";

const GATE_LABEL: Record<GateId, string> = {
  SAFETY: "Safety",
  IDENTITY: "Identity",
  AVAILABILITY: "Availability",
  CAPACITY: "Capacity",
  SKILL: "Skill",
  CREDENTIALS: "Credentials",
  TRAINING: "Training",
  ASSET: "Equipment",
  RANGE: "Travel range",
};

/** The nearest rejected candidate across all slots (the "why not the closest person?" story). */
export function nearestRejection(matches: SlotMatch[], slots: RequirementSlot[]) {
  const options: { slot: RequirementSlot; rejected: CandidateEvaluation; selected: CandidateEvaluation; specialist: boolean }[] = [];
  for (const m of matches) {
    const top = m.candidates.find((c) => c.eligible);
    const slot = slots.find((s) => s.id === m.slotId);
    if (!top || !slot) continue;
    for (const r of m.candidates) {
      const capabilityGap = r.gates.some((g) => !g.passed && ["CREDENTIALS", "SKILL", "IDENTITY", "TRAINING"].includes(g.gate));
      if (!r.eligible && capabilityGap && r.distanceKm < top.distanceKm) {
        options.push({ slot, rejected: r, selected: top, specialist: slot.credentials.some((c) => c !== "BACKGROUND_CHECK") });
      }
    }
  }
  const rank = (o: (typeof options)[number]) => (o.specialist ? 0 : 2) + (o.slot.kind === "PERSON" ? 0 : 1);
  options.sort((a, b) => rank(a) - rank(b) || a.rejected.distanceKm - b.rejected.distanceKm);
  return options[0] ?? null;
}

export function NearestRejectionCallout({ detail }: { detail: IncidentDetail }) {
  const n = nearestRejection(detail.matches, detail.incident.requirements);
  if (!n) return null;
  const failed = n.rejected.gates.filter((g) => !g.passed);
  return (
    <div className="rounded-md border-2 border-trained/50 bg-trained-soft px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-trained">Proximity never overrides a missing credential (rule R-M01)</div>
      <div className="mt-1.5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-md bg-white p-2.5 ring-1 ring-life/30">
          <div className="flex items-center gap-2">
            <X className="h-4 w-4 text-life" aria-hidden />
            <span className="font-semibold">{n.rejected.name}</span>
            <span className="ml-auto text-sm font-semibold text-life">{n.rejected.distanceKm} km</span>
          </div>
          <div className="text-xs text-muted">Nearest candidate for “{n.slot.label}” — rejected</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {failed.map((g) => (
              <li key={g.gate} className="text-life">
                <span className="font-semibold">{GATE_LABEL[g.gate]}:</span> {g.detail}
              </li>
            ))}
          </ul>
        </div>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-trained sm:block" aria-hidden />
        <div className="rounded-md bg-white p-2.5 ring-1 ring-done/40">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-done" aria-hidden />
            <span className="font-semibold">{n.selected.name}</span>
            <span className="ml-auto text-sm font-semibold text-done">{n.selected.distanceKm} km</span>
          </div>
          <div className="text-xs text-muted">Farther, but passes every gate — ranked #1 (score {n.selected.score})</div>
          <div className="mt-1 text-xs text-done">{n.selected.gates.find((g) => g.gate === "CREDENTIALS")?.detail ?? "All gates passed"}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ScoreBar({ c }: { c: CandidateEvaluation }) {
  return (
    <div className="w-full">
      <div className="flex h-2 w-full overflow-hidden rounded bg-slate-100" aria-hidden>
        {c.scoreBreakdown.map((s, i) => (
          <div key={s.label} style={{ width: `${s.points}%`, background: ["#0f5fbf", "#0f766e", "#6d28d9", "#a15c07", "#15803d", "#c2410c", "#1d4ed8", "#64748b"][i] }} />
        ))}
      </div>
    </div>
  );
}

function CandidateRow({ c, slot, assigned, canPick, onPick }: { c: CandidateEvaluation; slot: RequirementSlot; assigned: boolean; canPick: boolean; onPick?: () => void }) {
  const [open, setOpen] = useState(false);
  const failed = c.gates.filter((g) => !g.passed);
  return (
    <li className={cn("px-3 py-2", assigned && "bg-done-soft/60", !c.eligible && "bg-slate-50/70")}>
      <div className="flex flex-wrap items-center gap-2">
        {c.kind === "ORGANIZATION" ? <Building2 className="h-4 w-4 text-muted" aria-hidden /> : <User className="h-4 w-4 text-muted" aria-hidden />}
        <span className={cn("font-semibold", !c.eligible && "text-slate-500")}>{c.name}</span>
        <span className="text-xs text-muted">{c.distanceKm} km</span>
        {c.offered ? <Pill className="bg-active-soft text-active">volunteered</Pill> : null}
        {assigned ? (
          <Pill className="bg-done text-white">
            <Check className="h-3 w-3" /> on team
          </Pill>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {c.eligible ? (
            <span className="font-mono text-sm font-bold text-ink">{c.score}</span>
          ) : (
            <Pill className="bg-life-soft text-life">
              <Ban className="h-3 w-3" /> rejected
            </Pill>
          )}
          {canPick && c.eligible && !assigned && onPick ? (
            <Button size="sm" variant="secondary" onClick={onPick} aria-label={`Assign ${c.name} as ${slot.label}`}>
              Assign
            </Button>
          ) : null}
          <button className="rounded p-1 text-muted hover:bg-slate-100" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Show gate results for ${c.name}`}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </span>
      </div>
      {c.eligible ? (
        <div className="mt-1.5">
          <ScoreBar c={c} />
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {failed.map((g) => (
            <span key={g.gate} className="rounded bg-life-soft px-1.5 py-0.5 text-xs text-life">
              <span className="font-semibold">{GATE_LABEL[g.gate]}:</span> {g.detail}
            </span>
          ))}
        </div>
      )}
      {open ? (
        <div className="mt-2 grid gap-2 rounded-md border border-line bg-white p-2 text-xs sm:grid-cols-2">
          <ul className="space-y-0.5">
            {c.gates.map((g) => (
              <li key={g.gate} className="flex gap-1.5">
                {g.passed ? <Check className="h-3.5 w-3.5 shrink-0 text-done" /> : <X className="h-3.5 w-3.5 shrink-0 text-life" />}
                <span>
                  <span className="font-semibold">{GATE_LABEL[g.gate]}</span> — {g.detail}
                </span>
              </li>
            ))}
          </ul>
          {c.eligible ? (
            <ul className="space-y-0.5">
              {c.scoreBreakdown.map((s) => (
                <li key={s.label} className="flex justify-between gap-2">
                  <span>{s.label}</span>
                  <span className="font-mono">
                    {s.points}/{s.max}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Not scored — candidates are scored only after passing every hard gate.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function CandidatesPanel({ detail, handle, canAct, compact }: { detail: IncidentDetail; handle?: IncidentHandle; canAct: boolean; compact?: boolean }) {
  const { incident, matches, mission } = detail;
  const [showRejected, setShowRejected] = useState(true);
  const assignedBySlot = new Map((mission?.assignments ?? []).map((a) => [a.slotId, a.responderId]));
  // Coordinators can hand-pick before or after the engine proposes a team (overrides still pass every gate).
  const editable = canAct && incident.status !== "GUIDED" && (!mission || mission.status === "PROPOSED" || mission.status === "CANCELLED");
  const pick = (slotId: string, responderId: string) => {
    const overrides: Record<string, string> = {};
    for (const a of mission?.status === "PROPOSED" ? mission.assignments : []) if (a.selectedBy === "COORDINATOR") overrides[a.slotId] = a.responderId;
    overrides[slotId] = responderId;
    void handle?.incidentAction({ action: "propose", overrides });
  };

  if (!incident.triage.civilianDispatchAllowed) return null;
  return (
    <Card aria-labelledby="cand-h">
      <CardHeader
        id="cand-h"
        icon={<Users className="h-4 w-4 text-brand" />}
        title="Candidate resources"
        subtitle="Hard gates first (pass/fail), then a transparent score among eligible candidates only."
        right={
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
            Show rejected
          </label>
        }
      />
      <div className="space-y-3 p-4">
        <NearestRejectionCallout detail={detail} />
        {canAct && incident.status === "GUIDED" && incident.requirements.length ? (
          <Callout tone="info" title="No coordinated help requested yet">
            Picking team members unlocks once the resident — or you, on their behalf — requests help under <em>Needs → resolution paths</em> (rule N-15).
          </Callout>
        ) : editable ? (
          <p className="text-sm text-muted">Choose <strong>Assign</strong> next to any eligible candidate to put them on the team; the engine fills the remaining roles.</p>
        ) : null}
        {!compact ? <CandidateMap detail={detail} /> : null}
        {matches.map((m) => {
          const slot = incident.requirements.find((s) => s.id === m.slotId)!;
          const list = showRejected ? m.candidates : m.candidates.filter((c) => c.eligible);
          return (
            <div key={m.slotId} className="rounded-md border border-line">
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-slate-50 px-3 py-2">
                {slot.kind === "PERSON" ? <User className="h-4 w-4" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
                <span className="font-semibold">{slot.label}</span>
                <Pill className={m.eligibleCount ? "bg-done-soft text-done" : "bg-life-soft text-life"}>
                  {m.eligibleCount} eligible / {m.candidates.length} in pool
                </Pill>
                <div className="w-full">
                  <SlotRequirementChips slot={slot} />
                </div>
              </div>
              {list.length ? (
                <ul className="divide-y divide-line">
                  {list.slice(0, compact ? 5 : 12).map((c) => (
                    <CandidateRow
                      key={c.responderId}
                      c={c}
                      slot={slot}
                      assigned={assignedBySlot.get(slot.id) === c.responderId}
                      canPick={editable}
                      onPick={() => pick(slot.id, c.responderId)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-3 text-sm text-life">No one in the community pool can safely fill this role. Request mutual aid or a partner organization.</p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function CandidateMap({ detail, height = "h-64" }: { detail: IncidentDetail; height?: string }) {
  const { incident, matches, mission } = detail;
  const { markers, lines, shapes } = useMemo(() => {
    const assigned = new Set((mission?.assignments ?? []).map((a) => a.responderId));
    const seen = new Map<string, MapMarker>();
    for (const m of matches) {
      for (const c of m.candidates) {
        const r = detail.responders[c.responderId];
        if (!r) continue;
        const prev = seen.get(c.responderId);
        const eligible = c.eligible || (prev ? !prev.hollow : false);
        seen.set(c.responderId, {
          id: c.responderId,
          position: r.location,
          kind: r.kind === "ORGANIZATION" ? "org" : "person",
          color: assigned.has(c.responderId) ? "#15803d" : eligible ? "#0f5fbf" : "#b42318",
          hollow: !eligible && !assigned.has(c.responderId),
          selected: assigned.has(c.responderId),
          label: `${r.name} — ${assigned.has(c.responderId) ? "on team" : eligible ? "eligible" : "rejected"} (${c.distanceKm} km)`,
        });
      }
    }
    const ms: MapMarker[] = [
      { id: incident.id, position: incident.location, kind: "target", color: "#0b1f33", glyph: incident.priority.level, label: `${incident.number} — ${incident.locationLabel}` },
      ...seen.values(),
    ];
    const ls: MapLine[] = (mission?.assignments ?? [])
      .filter((a, i, arr) => arr.findIndex((x) => x.responderId === a.responderId) === i)
      .map((a) => ({ id: a.responderId, from: detail.responders[a.responderId]?.location ?? incident.location, to: incident.location, color: "#15803d", dashed: mission?.status === "PROPOSED" }));
    const route = mission?.route ?? detail.routePreview;
    const shapes: MapShape[] = [];
    const prev = mission?.routeHistory?.at(-1);
    if (prev) shapes.push({ id: "route-prev", geometry: { type: "LineString", coordinates: prev.path }, color: "#94a3b8", dashed: true, weight: 3, label: `Previous route · ${prev.etaMinutes} min` });
    if (route)
      shapes.push({
        id: "route",
        geometry: { type: "LineString", coordinates: route.path },
        color: mission?.status === "ON_HOLD" ? "#b42318" : mission?.route ? "#0f766e" : "#0f5fbf",
        dashed: !mission?.route || mission.status === "ON_HOLD",
        weight: 4,
        label: `${mission?.route ? "Route" : "Planned route"}: ${route.roads.join(" → ") || "direct"} · ${route.etaMinutes} min`,
      });
    // The lead's straight line is replaced by the planned route.
    const fromLead = (l: MapLine) => !!route && Math.abs(l.from.lat - route.origin.lat) < 1e-6 && Math.abs(l.from.lng - route.origin.lng) < 1e-6;
    return { markers: ms, lines: ls.filter((l) => !fromLead(l)), shapes };
  }, [detail, incident, matches, mission]);

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <OpsMap markers={markers} lines={lines} shapes={shapes} fit fitKey={`${incident.id}-${mission?.id ?? "none"}`} className={height} ariaLabel="Map of the incident and candidate responders" />
      <div className="flex flex-wrap gap-3 border-t border-line bg-slate-50 px-3 py-1.5 text-xs text-muted">
        <Legend color="#15803d">Assigned</Legend>
        <Legend color="#0f5fbf">Eligible</Legend>
        <Legend color="#b42318" hollow>
          Rejected
        </Legend>
        <span>● person ■ organization</span>
        {detail.mission?.route || detail.routePreview ? <span className="text-active">━ route (team lead)</span> : null}
      </div>
    </div>
  );
}

function Legend({ color, hollow, children }: { color: string; hollow?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-3 w-3 rounded-full" style={{ background: hollow ? "#fff" : color, border: `2px solid ${color}` }} aria-hidden />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export function TeamPanel({ detail, handle, canAct }: { detail: IncidentDetail; handle: IncidentHandle; canAct: boolean }) {
  const { incident, mission } = detail;
  if (!incident.triage.civilianDispatchAllowed) return null;
  const groups = new Map<string, { responderId: string; slots: string[]; reasons: string[]; kind: string; assets: string[] }>();
  for (const a of mission?.assignments ?? []) {
    const slot = incident.requirements.find((s) => s.id === a.slotId);
    const g = groups.get(a.responderId) ?? { responderId: a.responderId, slots: [], reasons: [], kind: detail.responders[a.responderId]?.kind ?? "PERSON", assets: [] };
    g.slots.push(slot?.label ?? a.slotId);
    for (const r of a.reasons) if (!g.reasons.includes(r)) g.reasons.push(r);
    groups.set(a.responderId, g);
  }
  const noMission = !mission || mission.status === "CANCELLED";
  return (
    <Card aria-labelledby="team-h">
      <CardHeader
        id="team-h"
        icon={<Users className="h-4 w-4 text-forming" />}
        title={mission && !noMission ? `${mission.code} — ${mission.title}` : "Team formation"}
        subtitle={noMission ? "The engine proposes the best eligible team; a coordinator reviews and dispatches." : "Why each person and resource was selected."}
        right={mission && !noMission ? <MissionStatusBadge status={mission.status} /> : null}
      />
      <div className="space-y-3 p-4">
        {noMission && incident.status === "GUIDED" ? (
          <p className="text-sm text-muted">
            No coordinated help requested yet (rule N-15). The resident chooses — or a coordinator can request it on their behalf under <em>Needs → resolution paths</em>.
          </p>
        ) : noMission ? (
          canAct ? (
            <Button size="lg" busy={handle.busy === "propose"} onClick={() => void handle.incidentAction({ action: "propose" })}>
              <Users className="h-4 w-4" /> Assemble team
            </Button>
          ) : (
            <p className="text-sm text-muted">Waiting for a coordinator to assemble a team.</p>
          )
        ) : (
          <>
            {(() => {
              const unfilled = mission!.unfilledSlotIds.map((id) => incident.requirements.find((s) => s.id === id)).filter((s): s is RequirementSlot => !!s);
              if (!unfilled.length) return null;
              const blocking = unfilled.filter((s) => !slotIsOptional(s));
              return blocking.length ? (
                <Callout tone="warn" title="Essential role unfilled — dispatch blocked">
                  {unfilled.map((s) => s.label).join(", ")} — no eligible resource available. Essential roles can&apos;t be skipped; request mutual aid or recruit through a partner.
                </Callout>
              ) : (
                <Callout tone="info" title="Optional equipment missing — you can still dispatch">
                  {unfilled.map((s) => s.label).join(", ")} — no eligible resource available. Dispatch below and note what the team will go without (e.g. the resident has their own).
                </Callout>
              );
            })()}
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[...groups.values()].map((g) => {
                const r = detail.responders[g.responderId];
                return (
                  <li key={g.responderId} className="rounded-md border border-line p-3">
                    <div className="flex items-start gap-2">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white", g.kind === "ORGANIZATION" ? "bg-slate-600" : "bg-forming")} aria-hidden>
                        {g.kind === "ORGANIZATION" ? <Building2 className="h-4 w-4" /> : r?.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-ink">{r?.name ?? g.responderId}</div>
                        <div className="text-xs text-muted">{r?.headline}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {g.slots.map((s) => (
                            <Pill key={s} className="bg-forming-soft text-forming">
                              {s}
                            </Pill>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] font-bold uppercase tracking-wide text-muted">Why selected</div>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {g.reasons.map((x) => (
                        <li key={x} className="flex gap-1.5">
                          {x.startsWith("Selected over") ? <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trained" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-done" />}
                          <span className={x.startsWith("Selected over") ? "text-trained" : undefined}>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {canAct && mission!.status === "PROPOSED" ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" busy={handle.busy === "propose"} onClick={() => void handle.incidentAction({ action: "propose" })}>
                  Re-run matching
                </Button>
                <span className="self-center text-xs text-muted">Use “Assign” in the candidate list to swap in another eligible resource.</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

const STEPS: { status: MissionStatus; label: string }[] = [
  { status: "PROPOSED", label: "Team proposed" },
  { status: "DISPATCHED", label: "Dispatched" },
  { status: "IN_PROGRESS", label: "On scene" },
  { status: "COMPLETED", label: "Completed" },
  { status: "VERIFIED", label: "Verified" },
];

export function MissionStepper({ mission }: { mission: Mission }) {
  // Rerouting is still "dispatched"; a hold keeps the step it interrupted.
  const effective = mission.status === "REROUTING" ? "DISPATCHED" : mission.status === "ON_HOLD" ? (mission.heldFrom ?? "DISPATCHED") : mission.status;
  const idx = STEPS.findIndex((s) => s.status === effective);
  const times: Partial<Record<MissionStatus, string | undefined>> = {
    PROPOSED: mission.createdAt,
    DISPATCHED: mission.dispatchedAt,
    IN_PROGRESS: mission.startedAt,
    COMPLETED: mission.completedAt,
    VERIFIED: mission.verifiedAt,
  };
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Mission progress">
      {STEPS.map((s, i) => (
        <li key={s.status} className="text-center" aria-current={i === idx ? "step" : undefined}>
          <div className={cn("mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", i <= idx ? "bg-done text-white" : "bg-slate-200 text-slate-500")}>
            {i < idx || mission.status === "VERIFIED" ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          <div className={cn("mt-1 text-[11px] font-semibold", i <= idx ? "text-ink" : "text-muted")}>{s.label}</div>
          <div className="text-[10px] text-muted">{times[s.status] ? clock(times[s.status]!) : ""}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Dispatch button. When the only gap is optional equipment or a supporting role, the coordinator
 * can dispatch anyway after explicitly acknowledging what the team will go without.
 */
export function DispatchControls({ detail, handle, label }: { detail: IncidentDetail; handle: IncidentHandle; label?: string }) {
  const [note, setNote] = useState("");
  const mission = detail.mission!;
  const preview = detail.dispatchPreview;
  const missing = detail.incident.requirements.filter((s) => slotIsOptional(s) && !mission.assignments.some((a) => a.slotId === s.id));
  if (preview?.partialOk && missing.length) {
    const names = missing.map((s) => s.label).join(", ");
    return (
      <div className="space-y-2 rounded-md border border-trained/40 bg-trained-soft p-3 text-sm">
        <p>
          <span className="font-semibold">Every essential role is filled.</span> Missing optional: {names}. You can send the team now and
          note what they&apos;ll go without, or keep looking.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-muted">Note for the team (optional)</span>
          <input
            className="mt-1 w-full rounded border border-line px-2 py-1"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. resident has buckets and a mop; bring towels"
          />
        </label>
        <Button size="lg" variant="success" busy={handle.busy === "dispatch"} onClick={() => void handle.missionAction(mission.id, "dispatch", note, { allowPartial: true })}>
          <Send className="h-4 w-4" /> Dispatch {mission.code} without {missing.length === 1 ? names.toLowerCase() : `${missing.length} optional items`}
        </Button>
      </div>
    );
  }
  return (
    <Button size="lg" variant="success" busy={handle.busy === "dispatch"} disabled={!preview?.ok} onClick={() => void handle.missionAction(mission.id, "dispatch")}>
      <Send className="h-4 w-4" /> {label ?? `Dispatch ${mission.code}`}
    </Button>
  );
}

export function MissionPanel({ detail, handle }: { detail: IncidentDetail; handle: IncidentHandle }) {
  const sys = useSystem();
  const { mission, dispatchPreview, routePreview } = detail;
  const [note, setNote] = useState("");
  if (!mission || mission.status === "CANCELLED") return null;
  const isCoordinator = sys.persona.kind === "coordinator";
  const onTeam = sys.persona.kind === "responder" && mission.assignments.some((a) => a.responderId === sys.persona.id);
  const canTeam = isCoordinator || onTeam;
  const checks = mission.status === "PROPOSED" ? dispatchPreview?.checks : mission.dispatchChecks;

  return (
    <Card aria-labelledby="msn-h">
      <CardHeader id="msn-h" icon={<Send className="h-4 w-4 text-active" />} title="Dispatch & mission tracking" right={<MissionStatusBadge status={mission.status} />} />
      <div className="space-y-4 p-4">
        <MissionStepper mission={mission} />
        {mission.hold ? (
          <HoldBlock hold={mission.hold} code={mission.code} canResume={isCoordinator} busy={handle.busy === "resume"} onResume={() => void handle.missionAction(mission.id, "resume")} />
        ) : null}
        {mission.route || routePreview ? (
          <RouteSummary route={(mission.route ?? routePreview)!} previous={mission.routeHistory?.at(-1)} highlight={mission.status === "REROUTING"} preview={!mission.route}>
            {mission.status === "REROUTING" && canTeam ? (
              <Button size="sm" className="mt-1.5" busy={handle.busy === "ack-route"} onClick={() => void handle.missionAction(mission.id, "ack-route")}>
                <Check className="h-3.5 w-3.5" /> Team has the new route
              </Button>
            ) : null}
          </RouteSummary>
        ) : null}
        <DecisionRecords decisions={mission.decisions ?? []} />
        {checks ? (
          <div>
            <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-active" /> Dispatch validation gate {mission.status === "PROPOSED" ? "(live preview)" : "(passed at dispatch)"}
            </h3>
            <ul className="space-y-1">
              {checks.map((c) => (
                <li key={c.id} className={cn("flex gap-2 rounded px-2 py-1 text-sm", c.passed ? "bg-done-soft/60" : c.acknowledgeable ? "bg-trained-soft" : "bg-life-soft")}>
                  {c.passed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" /> : c.acknowledgeable ? <span className="mt-0.5 h-4 w-4 shrink-0 text-center font-bold text-trained">!</span> : <X className="mt-0.5 h-4 w-4 shrink-0 text-life" />}
                  <span>
                    <span className="font-semibold">{c.label}</span> — {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {handle.error ? (
          <Callout tone="danger" title={handle.error}>
            {Array.isArray((handle.errorDetails as { checks?: unknown[] })?.checks) ? "See the failed checks above." : null}
          </Callout>
        ) : null}

        {mission.status === "PROPOSED" ? (
          isCoordinator ? (
            <DispatchControls detail={detail} handle={handle} />
          ) : (
            <p className="text-sm text-muted">Only an authorized coordinator can dispatch (rule R-D02).</p>
          )
        ) : null}

        {mission.briefing && mission.status !== "PROPOSED" ? (
          <div className="rounded-md border border-line bg-slate-50 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted">
              <ClipboardCheck className="h-3.5 w-3.5" /> Team briefing — {mission.briefing.provider === "azure-ai-foundry" ? `drafted by Azure AI Foundry (${mission.briefing.model})` : "template"} · notification simulated
            </div>
            <p className="whitespace-pre-line text-ink">{mission.briefing.text}</p>
          </div>
        ) : null}

        {(mission.status === "DISPATCHED" || mission.status === "REROUTING" || mission.status === "IN_PROGRESS") && canTeam ? (
          <div className="space-y-2">
            {mission.status === "DISPATCHED" || mission.status === "REROUTING" ? (
              <Button variant="secondary" busy={handle.busy === "start"} onClick={() => void handle.missionAction(mission.id, "start")}>
                <Truck className="h-4 w-4" /> Team on scene
              </Button>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[16rem] flex-1 text-sm">
                <span className="block text-xs font-semibold text-muted">Completion note</span>
                <input className="mt-0.5 w-full rounded border border-line px-2 py-1.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Tree cut and cleared; driveway open." />
              </label>
              <Button variant="success" busy={handle.busy === "complete"} onClick={() => void handle.missionAction(mission.id, "complete", note)}>
                <CircleCheckBig className="h-4 w-4" /> Mark complete
              </Button>
            </div>
          </div>
        ) : null}

        {mission.status === "COMPLETED" ? (
          <div className="space-y-2">
            <Callout tone="success" title="Team reports the work is done">
              “{mission.completionNote}” — resources released. Completion must be verified by the coordinator or the resident.
            </Callout>
            {isCoordinator || sys.persona.kind === "resident" ? (
              <Button variant="success" busy={handle.busy === "verify"} onClick={() => void handle.missionAction(mission.id, "verify", "Confirmed with resident.")}>
                <BadgeCheck className="h-4 w-4" /> Verify completion
              </Button>
            ) : null}
          </div>
        ) : null}

        {mission.status === "VERIFIED" ? (
          <Callout tone="success" title={`Verified by ${mission.verification?.by}`}>
            {mission.verification?.note ? `“${mission.verification.note}” ` : ""}Incident resolved. Volunteer hours credited and consumable supplies drawn down.
          </Callout>
        ) : null}

        {isCoordinator && ["PROPOSED", "DISPATCHED", "REROUTING", "ON_HOLD"].includes(mission.status) ? (
          <button className="text-xs text-muted underline hover:text-life" onClick={() => void handle.missionAction(mission.id, "cancel", "Cancelled by coordinator")}>
            Cancel mission
          </button>
        ) : null}
      </div>
    </Card>
  );
}
