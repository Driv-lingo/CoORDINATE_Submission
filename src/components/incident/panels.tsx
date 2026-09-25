"use client";

import {
  AlertTriangle,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileText,
  History,
  Info,
  ListChecks,
  Pencil,
  Phone,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  ASSET_LABELS,
  CATEGORY_LABELS,
  CREDENTIAL_LABELS,
  DESTINATION_LABELS,
  ESCALATION_LABELS,
  HANDOFF_STATUS_LABELS,
  HAZARD_LABELS,
  NEED_LABELS,
  PRIORITY_LABELS,
  SKILL_LABELS,
  TRAINING_LABELS,
  TRIAGE_LABELS,
  VULNERABILITY_LABELS,
} from "@/domain/catalog";
import { HAZARDS, NEEDS, type Hazard, type Incident, type NeedType, type RequirementSlot } from "@/domain/types";
import { HAZARD_RULES } from "@/engine/rules";
import { clock, cn } from "@/lib/format";
import { HazardChip, PriorityBadge, TRIAGE_STYLE, TriageBadge } from "../badges";
import { Button, Callout, Card, CardHeader, Pill } from "../ui";
import type { IncidentHandle } from "./useIncident";

/* ------------------------------------------------------------------ */

export function RequestQuote({ incident }: { incident: Incident }) {
  const r = incident.request;
  return (
    <div className="space-y-2">
      <blockquote className="rounded-md border-l-4 border-brand bg-brand-soft/60 px-3 py-2 text-[15px] leading-relaxed text-ink">“{r.text}”</blockquote>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Field label="Location">{incident.locationLabel}</Field>
        <Field label="People (form)">{r.peopleAffected ?? "—"}</Field>
        <Field label="Immediate danger">{r.immediateDanger ? <span className="font-semibold text-life">Yes</span> : "No"}</Field>
        <Field label="Source">{incident.source === "PHONE_TRIAGE" ? "Phone triage" : incident.source === "COORDINATOR" ? "Coordinator" : "Resident app"}</Field>
      </dl>
      {r.photoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photoDataUrl} alt="Photo submitted with the request" className="max-h-48 rounded-md border border-line" />
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate text-ink">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function InterpretationPanel({ incident, showRequest = true }: { incident: Incident; showRequest?: boolean }) {
  const it = incident.interpretation;
  const p = it.proposal;
  const foundry = it.provider === "azure-ai-foundry";
  return (
    <Card aria-labelledby="interp-h">
      <CardHeader
        id="interp-h"
        icon={<Sparkles className="h-4 w-4 text-brand" />}
        title="AI interpretation"
        subtitle="The model proposes a structured incident. It makes no safety or dispatch decisions."
        right={
          <Pill className={foundry ? "bg-brand text-white" : "bg-slate-100 text-slate-700 ring-1 ring-slate-300"} title={it.fallbackReason}>
            {foundry ? <Cpu className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            {foundry ? `Azure AI Foundry · ${it.model}` : "Local rules interpreter"}
          </Pill>
        }
      />
      <div className="space-y-4 p-4">
        {showRequest ? <RequestQuote incident={incident} /> : null}
        {it.fallbackReason ? <Callout tone="warn">{it.fallbackReason}</Callout> : null}
        <div className="rounded-md border border-line">
          <div className="flex items-center justify-between border-b border-line bg-slate-50 px-3 py-1.5 text-xs font-semibold text-muted">
            <span>Proposed incident (untrusted until validated)</span>
            <span>
              confidence {Math.round(p.confidence * 100)}% · {it.latencyMs} ms
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-2">
            <Field label="Category">{CATEGORY_LABELS[p.category]}</Field>
            <Field label="People affected">{p.peopleAffected}</Field>
            <div className="sm:col-span-2">
              <Field label="Summary">{p.summary || "—"}</Field>
            </div>
            <ChipField label="Hazards" items={p.hazards.map((h) => HAZARD_LABELS[h])} tone="danger" empty="None flagged" />
            <Field label="Immediate life threat">{p.immediateLifeThreat ? <span className="font-semibold text-life">Yes</span> : "No"}</Field>
            <ChipField label="Vulnerabilities" items={p.vulnerabilities.map((v) => VULNERABILITY_LABELS[v])} empty="None" />
            <ChipField label="Needs" items={p.needs.map((n) => NEED_LABELS[n])} empty="None" />
          </dl>
        </div>
        <ValidationList incident={incident} />
      </div>
    </Card>
  );
}

function ChipField({ label, items, tone, empty }: { label: string; items: string[]; tone?: "danger"; empty: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {items.length ? (
          items.map((x) => (
            <Pill key={x} className={tone === "danger" ? "bg-life text-white" : "bg-slate-100 text-slate-800 ring-1 ring-slate-200"}>
              {x}
            </Pill>
          ))
        ) : (
          <span className="text-sm text-muted">{empty}</span>
        )}
      </div>
    </div>
  );
}

export function ValidationList({ incident }: { incident: Incident }) {
  const notes = incident.validation;
  const scanned = incident.hazardMentions;
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
        <ClipboardCheck className="h-4 w-4 text-active" /> Deterministic validation
      </h3>
      <ul className="space-y-1 text-sm">
        <li className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" aria-hidden />
          <span>Schema check: unknown codes dropped, numbers clamped, resident answers take precedence.</span>
        </li>
        <li className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" aria-hidden />
          <span>
            Independent safety keyword scan:{" "}
            {scanned.length === 0
              ? "no hazard language found."
              : scanned.map((m, i) => (
                  <span key={i} className={cn("mr-1 inline-block rounded px-1 font-mono text-xs", m.negated ? "bg-slate-100 text-slate-600" : "bg-life-soft text-life")}>
                    “{m.phrase}”{m.negated ? " (negated)" : ""}
                  </span>
                ))}
          </span>
        </li>
        {notes.map((n, i) => (
          <li key={i} className="flex gap-2">
            {n.kind === "REJECTED" ? (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-life" aria-hidden />
            ) : n.kind === "ADDED" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-trained" aria-hidden />
            ) : (
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            )}
            <span>
              <span className="mr-1 text-[11px] font-bold uppercase text-muted">{n.kind.replace(/_/g, " ").toLowerCase()}</span>
              {n.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function TriagePanel({ incident, handle, canAct }: { incident: Incident; handle?: IncidentHandle; canAct: boolean }) {
  const t = incident.triage;
  const style = TRIAGE_STYLE[t.level];
  const cleared = new Set(incident.hazardClearances.map((c) => c.hazard));
  return (
    <Card aria-labelledby="triage-h">
      <CardHeader
        id="triage-h"
        icon={<ShieldCheck className="h-4 w-4 text-active" />}
        title="Deterministic safety triage"
        subtitle="Rule engine — no AI. Same inputs always produce the same decision."
        right={<PriorityBadge level={incident.priority.level} />}
      />
      <div className="space-y-4 p-4">
        <div className={cn("rounded-md border-l-8 px-4 py-3", t.civilianDispatchAllowed ? "bg-slate-50" : "bg-life-soft")} style={{ borderColor: style.hex }}>
          <div className="flex flex-wrap items-center gap-2">
            <TriageBadge level={t.level} full />
            <span className="text-sm text-muted">
              Priority {incident.priority.level} ({PRIORITY_LABELS[incident.priority.level]}, score {incident.priority.score})
            </span>
          </div>
          <p className="mt-1 text-sm text-ink">{TRIAGE_LABELS[t.level].description}</p>
          <p className="mt-1 text-xs text-muted">Priority factors: {incident.priority.factors.join(" · ")}</p>
        </div>

        {t.level === "INFORMATION_ONLY" ? <InformationOnlyBlock incident={incident} /> : !t.civilianDispatchAllowed ? <ProhibitedBlock incident={incident} handle={handle} canAct={canAct} /> : null}

        <div>
          <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-muted" /> Hazard rules evaluated ({HAZARDS.length})
          </h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {HAZARDS.map((h) => {
              const present = incident.assessment.hazards.includes(h);
              const isCleared = cleared.has(h);
              return (
                <li
                  key={h}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1 text-sm",
                    present && !isCleared ? "bg-life-soft font-semibold text-life" : isCleared ? "bg-slate-50 text-muted" : "text-slate-600",
                  )}
                >
                  {present && !isCleared ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0 text-done" />}
                  <span className="font-mono text-[11px] text-muted">{HAZARD_RULES[h].id}</span>
                  <span className="truncate">{HAZARD_LABELS[h]}</span>
                  <span className="ml-auto text-[11px]">{present ? (isCleared ? "cleared" : "PRESENT") : "clear"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {t.rulesFired.length ? (
          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Rules fired</h3>
            <ul className="space-y-1.5">
              {t.rulesFired.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold",
                      r.effect === "ESCALATE" ? "bg-life text-white" : r.effect === "REQUIRE" ? "bg-trained-soft text-trained" : "bg-done-soft text-done",
                    )}
                  >
                    {r.ruleId}
                  </span>
                  <span>
                    <span className="font-semibold">{r.title}.</span> {r.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Advisories incident={incident} handle={handle} canAct={canAct} />
      </div>
    </Card>
  );
}

/**
 * Escalations are recommendations. CoORDINATE has no link to 911, utilities, shelters or caseworkers:
 * each handoff says WHY (rule), WHO (destination) and WHAT to hand off (summary); a coordinator makes
 * the contact and records it.
 */
export function HandoffList({ incident, handle, canAct }: { incident: Incident; handle?: IncidentHandle; canAct: boolean }) {
  return (
    <div>
      <ul className="space-y-3">
        {incident.handoffs.map((h) => (
          <li key={h.target} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {h.status === "RECOMMENDED" ? <AlertTriangle className="h-4 w-4 text-trained" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-done" aria-hidden />}
              <span className="font-semibold">{ESCALATION_LABELS[h.target]}</span>
              {h.destination ? <Pill className="bg-slate-100 text-slate-700">{DESTINATION_LABELS[h.destination]}</Pill> : null}
              <Pill className={h.status === "RECOMMENDED" ? "bg-trained-soft text-trained" : "bg-done-soft text-done"}>{HANDOFF_STATUS_LABELS[h.status]}</Pill>
            </div>
            {h.reason ? (
              <p className="ml-6 mt-0.5 text-xs text-ink">
                <span className="font-semibold">Why:</span> {h.reason} {h.ruleId ? <span className="font-mono text-muted">[{h.ruleId}]</span> : null}
              </p>
            ) : null}
            <div className="ml-6 text-xs text-muted">
              {h.status === "RECOMMENDED"
                ? "Not contacted by CoORDINATE. A coordinator must make the contact and record it."
                : `${h.contactedBy ?? "Coordinator"} recorded contact at ${h.contactedAt ? clock(h.contactedAt) : "—"}${h.acknowledgedAt ? ` · acknowledged ${clock(h.acknowledgedAt)}` : ""}${h.reference ? ` · ref ${h.reference}` : ""}`}
            </div>
            {h.summary ? (
              <details className="ml-6 mt-1 rounded-md border border-line bg-slate-50">
                <summary className="cursor-pointer px-2 py-1 text-xs font-semibold text-ink">
                  What to hand off{" "}
                  <span className="font-normal text-muted">
                    · {h.summary.provider === "azure-ai-foundry" ? `drafted by Azure AI Foundry (${h.summary.model ?? "model"})` : "template"}
                  </span>
                </summary>
                <pre className="whitespace-pre-wrap break-words px-2 pb-2 font-sans text-xs text-ink">{h.summary.text}</pre>
              </details>
            ) : null}
            {canAct && handle && h.status !== "ACKNOWLEDGED" ? (
              <div className="ml-6 mt-1 flex flex-wrap gap-1">
                {h.status === "RECOMMENDED" ? (
                  <>
                    <Button size="sm" variant="ghost" busy={handle.busy === "draft-handoff"} onClick={() => void handle.incidentAction({ action: "draft-handoff", target: h.target })} title="Azure AI Foundry drafts a concise summary; nothing is sent">
                      <Sparkles className="h-3.5 w-3.5" /> Draft summary
                    </Button>
                    <Button size="sm" variant="ghost" busy={handle.busy === "record-contact"} onClick={() => void handle.incidentAction({ action: "record-contact", target: h.target, note: "Called by coordinator" })}>
                      I contacted them — record it
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" busy={handle.busy === "record-ack"} onClick={() => void handle.incidentAction({ action: "record-ack", target: h.target })}>
                    Record their acknowledgement
                  </Button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">CoORDINATE has no connection to 911, CAD, utilities, shelters or caseworkers and never contacts them itself.</p>
    </div>
  );
}

function InformationOnlyBlock({ incident }: { incident: Incident }) {
  return (
    <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <Info className="h-4 w-4" aria-hidden /> Information-only report — no mission created
      </div>
      <p className="mt-1 text-muted">
        The reporter described a road or area condition and asked for no help (rule R-I01). It was added to the operational picture as an <strong>unverified community report</strong>{" "}
        — it can only change routes once another independent source corroborates it. If help is actually needed, use <em>Adjust needs</em> below to convert it into a request.
      </p>
      {incident.assessment.summary ? <p className="mt-1 text-xs text-muted">Summary: {incident.assessment.summary}</p> : null}
    </div>
  );
}

function ProhibitedBlock({ incident, handle, canAct }: { incident: Incident; handle?: IncidentHandle; canAct: boolean }) {
  const t = incident.triage;
  const [clearing, setClearing] = useState<Hazard | null>(null);
  const [authority, setAuthority] = useState("");
  const clearable =
    incident.request.immediateDanger || incident.assessment.immediateLifeThreat
      ? []
      : incident.assessment.hazards.filter((h) => HAZARD_RULES[h].level === "PROFESSIONAL_RESPONSE_REQUIRED" && !incident.hazardClearances.some((c) => c.hazard === h));
  return (
    <div className="rounded-md border-2 border-life bg-white">
      <div className="flex items-center gap-2 bg-life px-3 py-2 text-sm font-bold uppercase tracking-wide text-white">
        <Ban className="h-4 w-4" /> Civilian dispatch prohibited
      </div>
      <div className="grid gap-4 p-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-ink">Professional escalation recommended</h4>
          <HandoffList incident={incident} handle={handle} canAct={canAct} />
        </div>
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-ink">Do not dispatch</h4>
          <ul className="space-y-1">
            {t.doNotDispatch.map((d) => (
              <li key={d} className="flex items-center gap-2 text-sm">
                <X className="h-4 w-4 text-life" aria-hidden /> {d}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {t.guidance.length ? (
        <div className="border-t border-line px-3 py-2 text-sm">
          <span className="font-semibold">
            <Phone className="mr-1 inline h-4 w-4" aria-hidden />
            Told to the resident:
          </span>{" "}
          {t.guidance.join(" ")}
        </div>
      ) : null}
      {canAct && handle && clearable.length ? (
        <div className="border-t border-line bg-slate-50 px-3 py-2 text-sm">
          {clearing ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handle.incidentAction({ action: "clear-hazard", hazard: clearing, authority: authority || "Responsible authority", note: "hazard made safe" }).then(() => setClearing(null));
              }}
            >
              <label className="text-sm">
                <span className="block text-xs font-semibold text-muted">Authority that cleared the {HAZARD_LABELS[clearing].toLowerCase()}</span>
                <input
                  className="mt-0.5 w-64 rounded border border-line px-2 py-1"
                  value={authority}
                  onChange={(e) => setAuthority(e.target.value)}
                  placeholder={clearing === "DOWNED_POWER_LINE" ? "Electric utility crew #12" : "Responsible authority"}
                  required
                />
              </label>
              <Button size="sm" type="submit" busy={handle.busy === "clear-hazard"}>
                Record clearance &amp; re-triage
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setClearing(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Rule R-C01: once the responsible authority makes the hazard safe, record it to re-triage.</span>
              {clearable.map((h) => (
                <Button key={h} size="sm" variant="secondary" onClick={() => setClearing(h)}>
                  {HAZARD_LABELS[h]} cleared…
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Advisories({ incident, handle, canAct }: { incident: Incident; handle?: IncidentHandle; canAct: boolean }) {
  if (!incident.advisories.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert className="h-4 w-4 text-trained" /> Advisories requiring a human
      </h3>
      <ul className="space-y-2">
        {incident.advisories.map((a) => (
          <li key={a.id} className={cn("rounded-md border px-3 py-2 text-sm", a.acknowledgedAt ? "border-line bg-slate-50" : "border-trained/50 bg-trained-soft")}>
            <div className="flex flex-wrap items-start gap-2">
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-trained ring-1 ring-trained/30">{a.ruleId}</span>
              <span className="min-w-0 flex-1">{a.message}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {a.acknowledgedAt ? (
                <span className="text-xs text-done">
                  <Check className="mr-1 inline h-3.5 w-3.5" />
                  Acknowledged by {a.acknowledgedBy} at {clock(a.acknowledgedAt)}
                </span>
              ) : canAct && handle ? (
                <Button size="sm" variant="secondary" busy={handle.busy === "ack-advisory"} onClick={() => void handle.incidentAction({ action: "ack-advisory", advisoryId: a.id })}>
                  I confirmed this with the resident
                </Button>
              ) : (
                <span className="text-xs font-semibold text-trained">Awaiting coordinator acknowledgement — dispatch blocked</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SlotRequirementChips({ slot }: { slot: RequirementSlot }) {
  return (
    <div className="flex flex-wrap gap-1">
      {slot.skill ? <Pill className="bg-slate-100 text-slate-800 ring-1 ring-slate-200">Skill: {SKILL_LABELS[slot.skill]}</Pill> : null}
      {slot.asset ? (
        <Pill className="bg-slate-100 text-slate-800 ring-1 ring-slate-200">
          {ASSET_LABELS[slot.asset]}
          {slot.quantity > 1 ? ` × ${slot.quantity}` : ""}
          {slot.accessibleRequired ? " (accessible)" : ""}
        </Pill>
      ) : null}
      {slot.credentials.map((c) => (
        <Pill key={c} className="bg-trained-soft text-trained ring-1 ring-trained/30" title="Verified external credential required">
          <ShieldCheck className="h-3 w-3" /> {CREDENTIAL_LABELS[c]}
        </Pill>
      ))}
      {slot.training.map((m) => (
        <Pill key={m} className="bg-general-soft text-general ring-1 ring-general/30" title="CoORDINATE training module required">
          Module: {TRAINING_LABELS[m].title}
        </Pill>
      ))}
    </div>
  );
}

export function RequirementsPanel({ incident, handle, canEdit = false }: { incident: Incident; handle?: IncidentHandle; canEdit?: boolean }) {
  const slots = incident.requirements;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NeedType[]>(incident.assessment.needs);
  const editable =
    canEdit && !!handle && (incident.triage.civilianDispatchAllowed || incident.triage.level === "INFORMATION_ONLY") && (incident.status === "OPEN" || incident.status === "TEAM_FORMING" || incident.status === "LOGGED");
  return (
    <Card aria-labelledby="req-h">
      <CardHeader
        id="req-h"
        icon={<FileText className="h-4 w-4 text-forming" />}
        title="Required capabilities"
        subtitle="Derived deterministically from validated needs and safety rules."
        right={
          editable && !editing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(incident.assessment.needs);
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> Adjust needs
            </Button>
          ) : null
        }
      />
      {editing && handle ? (
        <form
          className="space-y-2 border-b border-line bg-slate-50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handle.incidentAction({ action: "set-needs", needs: draft }).then((ok) => ok && setEditing(false));
          }}
        >
          <p className="text-xs text-muted">Correct what the AI understood. Hazards can&apos;t be removed here — only an authority&apos;s clearance (R-C01) can do that.</p>
          <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            <legend className="sr-only">Needs</legend>
            {NEEDS.map((n) => (
              <label key={n} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={draft.includes(n)} onChange={(e) => setDraft(e.target.checked ? [...draft, n] : draft.filter((x) => x !== n))} />
                {NEED_LABELS[n]}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button size="sm" type="submit" busy={handle.busy === "set-needs"}>
              Re-derive requirements
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {slots.length === 0 ? (
        incident.triage.civilianDispatchAllowed ? (
          <div className="p-4">
            <Callout tone="warn" title="No capabilities identified">
              The request didn&apos;t map to a known need, so no team can be formed or dispatched. {editable ? "Use “Adjust needs” to classify it." : "A coordinator must classify it."}
            </Callout>
          </div>
        ) : incident.triage.level === "INFORMATION_ONLY" ? (
          <p className="p-4 text-sm text-muted">No roles — information-only report. {editable ? "Use “Adjust needs” if the reporter does need help." : ""}</p>
        ) : (
          <p className="p-4 text-sm text-muted">No civilian roles — this incident is handled by professional responders.</p>
        )
      ) : (
        <ul className="divide-y divide-line">
          {slots.map((s) => (
            <li key={s.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className={s.kind === "PERSON" ? "bg-ink text-white" : "bg-slate-600 text-white"}>{s.kind === "PERSON" ? "Person" : "Equipment"}</Pill>
                <span className="font-semibold text-ink">{s.label}</span>
                <span className="ml-auto font-mono text-[11px] text-muted">from {s.derivedFrom.toLowerCase().replace(/_/g, " ")}</span>
              </div>
              <div className="mt-1.5">
                <SlotRequirementChips slot={s} />
              </div>
              <p className="mt-1 text-xs text-muted">{s.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

const ACTOR_STYLE: Record<string, string> = {
  resident: "bg-general-soft text-general",
  ai: "bg-brand text-white",
  rules: "bg-ink text-white",
  coordinator: "bg-forming-soft text-forming",
  volunteer: "bg-active-soft text-active",
  authority: "bg-pro-soft text-pro",
  system: "bg-slate-100 text-slate-700",
};

export function TimelinePanel({ incident }: { incident: Incident }) {
  return (
    <Card aria-labelledby="tl-h">
      <CardHeader id="tl-h" icon={<History className="h-4 w-4 text-muted" />} title="Audit timeline" subtitle="Every AI proposal, rule decision and human action is logged." />
      <ol className="space-y-2 p-4">
        {[...incident.timeline].reverse().map((e, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <time className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs text-muted" dateTime={e.at}>
              {clock(e.at)}
            </time>
            <Pill className={cn("h-fit shrink-0", ACTOR_STYLE[e.actor])}>{e.actor}</Pill>
            <span className="min-w-0 text-ink">{e.message}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function HazardSummary({ incident }: { incident: Incident }) {
  if (!incident.assessment.hazards.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {incident.assessment.hazards.map((h) => (
        <HazardChip key={h} hazard={h} cleared={incident.hazardClearances.some((c) => c.hazard === h)} />
      ))}
    </div>
  );
}
