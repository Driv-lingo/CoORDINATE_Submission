"use client";

import { useModeHref } from "@/components/SystemProvider";
import {
  AlertOctagon,
  BookOpen,
  Check,
  Compass,
  ExternalLink,
  Globe,
  HandHeart,
  Info,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  Radio,
  Siren,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { useState } from "react";
import type { IncidentDetail, ServiceView } from "@/domain/dto";
import {
  NEED_LABELS,
  NEED_RESIDENT_LABELS,
  NEED_STATUS_LABELS,
  RESOLUTION_PATH_LABELS,
  URGENCY_LABELS,
  VULNERABILITY_LABELS,
} from "@/domain/catalog";
import type { Need, ResolutionPath } from "@/domain/types";
import { cn } from "@/lib/format";
import { HandoffList } from "../incident/panels";
import type { IncidentHandle } from "../incident/useIncident";
import { Button, Callout, Card, CardHeader, Pill } from "../ui";

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
/* ------------------------------------------------------------------ */

export const PATH_STYLE: Record<ResolutionPath, { cls: string; icon: typeof Siren }> = {
  PROFESSIONAL_RESPONSE: { cls: "bg-life-soft text-life", icon: Siren },
  HUMAN_ESCALATION: { cls: "bg-pro-soft text-pro", icon: UserRound },
  COMMUNITY_MISSION: { cls: "bg-active-soft text-active", icon: Users },
  RESOURCE_TRANSFER: { cls: "bg-forming-soft text-forming", icon: Package },
  SERVICE_REFERRAL: { cls: "bg-brand-soft text-brand", icon: BookOpen },
  INFORMATION: { cls: "bg-slate-100 text-slate-700", icon: Info },
  SITUATIONAL_AWARENESS: { cls: "bg-slate-100 text-slate-700", icon: Radio },
};

export function PathBadge({ path, resident }: { path: ResolutionPath; resident?: boolean }) {
  const S = PATH_STYLE[path];
  const Icon = S.icon;
  return (
    <Pill className={S.cls} title={RESOLUTION_PATH_LABELS[path].description}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {resident ? RESOLUTION_PATH_LABELS[path].resident : RESOLUTION_PATH_LABELS[path].label}
    </Pill>
  );
}

function needTitle(n: Need, detail: IncidentDetail, resident: boolean): string {
  const mobility = detail.incident.assessment.vulnerabilities.includes("MOBILITY_LIMITED");
  if (n.type === "TRANSPORTATION" && mobility) return resident ? "Accessible transportation (evacuation support)" : "Accessible transportation";
  if (n.type === "SHELTER" && mobility) return resident ? "An accessible place to stay" : "Accessible shelter placement";
  return resident ? NEED_RESIDENT_LABELS[n.type] : NEED_LABELS[n.type];
}

function contactHref(kind: string, value: string): string | undefined {
  if (kind === "WEB") return value;
  if (/^[\d-]+$/.test(value)) return kind === "TEXT" ? `sms:${value.replace(/-/g, "")}` : `tel:${value.replace(/-/g, "")}`;
  return undefined;
}

function sourceLabel(s: ServiceView): string {
  try {
    return new URL(s.authoritativeSource).hostname.replace(/^www\./, "");
  } catch {
    return s.authoritativeSource;
  }
}

/** A trusted service with its provenance: who runs it, where the entry comes from, and when it was listed. */
export function ServiceCard({ s, compact }: { s: ServiceView; compact?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-ink">{s.name}</span>
        {s.simulated ? <Pill className="bg-trained-soft text-trained">EXERCISE</Pill> : null}
        {s.accessible ? <Pill className="bg-slate-100 text-slate-700">Accessible</Pill> : null}
      </div>
      {!compact ? <p className="text-xs text-muted">{s.description}</p> : null}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {s.contactMethods.map((c) => {
          const href = contactHref(c.kind, c.value);
          const Icon = c.kind === "PHONE" ? Phone : c.kind === "TEXT" ? MessageSquare : c.kind === "WEB" ? Globe : MapPin;
          const inner = (
            <>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {c.kind === "WEB" ? c.label : `${c.label}${c.kind === "PHONE" || c.kind === "TEXT" ? ` ${c.value}` : ` · ${c.value}`}`}
              {c.hours ? <span className="font-normal text-muted"> · {c.hours}</span> : null}
            </>
          );
          return href ? (
            <a key={c.kind + c.value + c.label} href={href} target={c.kind === "WEB" ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand hover:underline">
              {inner}
            </a>
          ) : (
            <span key={c.kind + c.value + c.label} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {inner}
            </span>
          );
        })}
      </div>
      {s.pending.length ? (
        <ul className="mt-1.5 space-y-0.5 text-xs text-trained">
          {s.pending.map((p) => (
            <li key={p}>⚠ {p}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-[11px] text-muted">
        {s.provider} · Source: {s.simulated ? s.authoritativeSource : sourceLabel(s)} · listed {s.lastVerifiedAt}
      </p>
    </div>
  );
}

function Evidence({ n }: { n: Need }) {
  if (!n.evidence.length) return null;
  return (
    <p className="text-xs text-muted">
      {n.origin === "SUGGESTED" ? "Suggested because: " : "From: "}
      {n.evidence.map((e, i) => (
        <span key={e.phrase + i}>
          {i ? "; " : ""}
          {e.by === "RULES" || e.by === "RESIDENT_FORM" ? e.phrase : `“${e.phrase}”`}
          {e.by === "AI" ? (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-brand-soft px-1 text-[10px] font-semibold text-brand">
              <Sparkles className="h-2.5 w-2.5" aria-hidden /> Foundry
            </span>
          ) : null}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Resident: the navigator answer                                        */
/* ------------------------------------------------------------------ */

const RESIDENT_GROUPS: { paths: ResolutionPath[]; title: string }[] = [
  { paths: ["PROFESSIONAL_RESPONSE"], title: "Emergency professionals" },
  { paths: ["HUMAN_ESCALATION"], title: "A person will follow up" },
  { paths: ["COMMUNITY_MISSION", "RESOURCE_TRANSFER"], title: "Community help" },
  { paths: ["SERVICE_REFERRAL"], title: "Trusted services" },
  { paths: ["INFORMATION", "SITUATIONAL_AWARENESS"], title: "Good to know" },
];

/**
 * What a resident sees: plain language, safety first, trusted options with
 * sources, and — only where appropriate — an offer of coordinated community help.
 */
export function NavigatorResult({ detail, handle, canRequest }: { detail: IncidentDetail; handle?: IncidentHandle; canRequest: boolean }) {
  const i = detail.incident;
  const nav = detail.navigator;
  const needs = i.needs ?? [];
  const professional = needs.some((n) => n.path === "PROFESSIONAL_RESPONSE" && n.status !== "RESOLVED");
  const foundry = i.interpretation.provider === "azure-ai-foundry";

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Compass className="h-4 w-4 text-brand" aria-hidden />
          <span>
            {foundry ? (
              <>
                Understood by <strong className="text-brand">Azure AI Foundry</strong>
              </>
            ) : (
              <>Understood by the local rules interpreter</>
            )}{" "}
            · checked by CoORDINATE&apos;s safety rules
          </span>
        </div>
        <p className="mt-1 text-[15px] text-ink">{i.assessment.summary}</p>
        <h2 className="mt-3 text-sm font-bold uppercase tracking-wide text-muted">We identified</h2>
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          {needs
            .filter((n) => n.origin === "STATED")
            .map((n) => (
              <li key={n.id} className="flex items-start gap-2 text-[15px]">
                <Check className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden /> {needTitle(n, detail, true)}
              </li>
            ))}
          {nav.considerations
            .filter((c) => c.vulnerability !== "LANGUAGE_ACCESS")
            .map((c) => (
              <li key={c.vulnerability} className="flex items-start gap-2 text-[15px]">
                <Check className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span>
                  Household consideration: {VULNERABILITY_LABELS[c.vulnerability].toLowerCase()}
                  {c.phrase ? <span className="text-sm text-muted"> — “{c.phrase}”</span> : null}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      <div className={cn("rounded-lg border-2 p-4", professional ? "border-life bg-life-soft" : "border-trained/50 bg-trained-soft")}>
        <div className={cn("flex items-center gap-2 font-bold", professional ? "text-life" : "text-ink")}>
          <AlertOctagon className="h-5 w-5" aria-hidden /> Immediate priority
        </div>
        <ul className="mt-1 space-y-1 text-[15px]">
          {nav.immediatePriority.map((l) => (
            <li key={l}>• {l}</li>
          ))}
        </ul>
        {professional ? (
          <a href="tel:911" className="mt-2 flex items-center justify-center gap-2 rounded-md bg-life px-4 py-2.5 text-lg font-bold text-white hover:bg-red-800">
            <Phone className="h-5 w-5" /> Call 911
          </a>
        ) : null}
      </div>

      {professional ? (
        <Callout tone="danger" title="Professional emergency response required. No community mission created." icon={<Siren className="h-5 w-5" />}>
          Volunteers are never sent to this hazard. A coordinator has a handoff summary ready — but CoORDINATE does not contact 911 or the utility itself. Call them yourself if you can do so from a safe place.
        </Callout>
      ) : null}

      {[...RESIDENT_GROUPS, { paths: [] as ResolutionPath[], title: "You may also need" }].map((g) => {
        const list = g.paths.length
          ? needs.filter((n) => g.paths.includes(n.path) && n.origin === "STATED" && n.status !== "NOT_REQUESTED")
          : needs.filter((n) => n.origin === "SUGGESTED" && n.status !== "NOT_REQUESTED");
        if (!list.length) return null;
        return (
          <section key={g.title} aria-label={g.title}>
            <h2 className="mb-1.5 text-sm font-bold uppercase tracking-wide text-muted">{g.title}</h2>
            <div className="space-y-2">
              {list.map((n) => (
                <Card key={n.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{needTitle(n, detail, true)}</span>
                    <PathBadge path={n.path} resident />
                    {n.status === "BLOCKED_BY_HAZARD" ? <Pill className="bg-life-soft text-life">On hold for safety</Pill> : null}
                    {["HELP_REQUESTED", "MISSION_ACTIVE", "RESOLVED", "HANDED_OFF"].includes(n.status) ? <Pill className="bg-done-soft text-done">{NEED_STATUS_LABELS[n.status]}</Pill> : null}
                  </div>
                  <p className="mt-0.5 text-sm text-ink">{n.reason}</p>
                  <Evidence n={n} />
                  {n.guidance.length ? (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {n.guidance.map((x) => (
                        <li key={x} className="flex gap-1.5">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden /> {x}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {n.serviceIds.length ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {n.serviceIds.map((id) => (nav.services[id] ? <ServiceCard key={id} s={nav.services[id]} compact /> : null))}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      <RequestHelpPanel detail={detail} handle={handle} canRequest={canRequest} />
    </div>
  );
}

/** Rule N-15: community help is offered, and the resident chooses what to ask for. */
export function RequestHelpPanel({ detail, handle, canRequest, onBehalf }: { detail: IncidentDetail; handle?: IncidentHandle; canRequest: boolean; onBehalf?: boolean }) {
  const needs = (detail.incident.needs ?? []).filter((n) => n.path === "COMMUNITY_MISSION" || n.path === "RESOURCE_TRANSFER");
  const offer = needs.filter((n) => n.status === "HELP_AVAILABLE" || n.status === "NOT_REQUESTED");
  const blocked = needs.filter((n) => n.status === "BLOCKED_BY_HAZARD");
  // Until the person changes a box, stated needs that are available are pre-selected (recomputed as needs change, e.g. after a hazard is cleared).
  const [choice, setChoice] = useState<Set<string> | null>(null);
  const picked = choice ?? new Set(offer.filter((n) => n.origin === "STATED" && n.status === "HELP_AVAILABLE").map((n) => n.id));
  const status = detail.incident.status;
  if (!needs.length) return null;
  if (blocked.length && !offer.length) {
    return (
      <Callout tone="warn" title="Community help is on hold" icon={<AlertOctagon className="h-5 w-5" />}>
        {blocked.map((n) => needTitle(n, detail, true)).join(", ")}: volunteers can&apos;t be sent while a hazard at this location is active. This can be offered again once the responsible authority makes it safe.
      </Callout>
    );
  }
  if (!offer.length || !["GUIDED", "OPEN"].includes(status) || detail.incident.missionId) return null;
  return (
    <Card className="border-active/40 p-4">
      <div className="flex items-center gap-2 font-bold text-ink">
        <HandHeart className="h-5 w-5 text-active" aria-hidden /> Community assistance may be available
      </div>
      <p className="mt-0.5 text-sm text-muted">
        Qualified, identity-verified volunteers and local organizations can help with the items you choose. A coordinator reviews every request before anyone is sent.
      </p>
      <fieldset className="mt-2 space-y-1.5">
        <legend className="sr-only">Choose what to request</legend>
        {offer.map((n) => (
          <label key={n.id} className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-[15px] hover:bg-slate-50">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={picked.has(n.id)}
              disabled={!canRequest}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(n.id);
                else next.delete(n.id);
                setChoice(next);
              }}
            />
            <span>
              {needTitle(n, detail, true)}
              <span className="ml-1 text-xs text-muted">· {URGENCY_LABELS[n.urgency].toLowerCase()}</span>
              {n.origin === "SUGGESTED" ? <span className="ml-1 text-xs text-muted">(suggested)</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      {canRequest && handle ? (
        <Button
          className="mt-3 w-full sm:w-auto"
          size="lg"
          variant="success"
          disabled={!picked.size}
          busy={handle.busy === "request-help"}
          onClick={() => void handle.incidentAction({ action: "request-help", needIds: [...picked] })}
        >
          <HandHeart className="h-5 w-5" /> {onBehalf ? "Request coordinated help for the resident" : "Request coordinated help"}
        </Button>
      ) : (
        <p className="mt-2 text-xs text-muted">Only the person who asked for help, or a coordinator on their behalf, can request it.</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Coordinator: needs and resolution paths                              */
/* ------------------------------------------------------------------ */

export function NeedsPanel({ detail, handle, canAct }: { detail: IncidentDetail; handle?: IncidentHandle; canAct: boolean }) {
  const mh = useModeHref();
  const i = detail.incident;
  const needs = i.needs ?? [];
  return (
    <Card>
      <CardHeader
        title="Needs → resolution paths"
        icon={<Compass className="h-4 w-4 text-brand" />}
        subtitle="Navigator rules N-01…N-15. Only community and resource needs the resident requested become capability requirements."
      />
      <ul className="divide-y divide-line">
        {needs.map((n) => (
          <li key={n.id} className="px-4 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-ink">{needTitle(n, detail, false)}</span>
              <PathBadge path={n.path} />
              <Pill className="bg-slate-100 text-slate-700">{NEED_STATUS_LABELS[n.status]}</Pill>
              <Pill className={n.urgency === "IMMEDIATE" ? "bg-life-soft text-life" : "bg-slate-100 text-slate-700"}>{URGENCY_LABELS[n.urgency]}</Pill>
              {n.origin === "SUGGESTED" ? <Pill className="bg-slate-100 text-slate-700">Suggested</Pill> : null}
              <span className="ml-auto font-mono text-[11px] text-muted">{n.ruleId}</span>
            </div>
            <p className="mt-0.5 text-ink">{n.reason}</p>
            <Evidence n={n} />
            {n.serviceIds.length ? (
              <p className="mt-0.5 text-xs text-muted">
                Services:{" "}
                {n.serviceIds
                  .map((id) => detail.navigator.services[id])
                  .filter(Boolean)
                  .map((s) => s!.name)
                  .join(" · ")}
              </p>
            ) : null}
            {canAct && handle && (n.path === "SERVICE_REFERRAL" || n.path === "HUMAN_ESCALATION" || n.path === "INFORMATION") && n.status !== "RESOLVED" ? (
              <Button size="sm" variant="ghost" className="mt-1" busy={handle.busy === "resolve-need"} onClick={() => void handle.incidentAction({ action: "resolve-need", needId: n.id, note: "" })}>
                <Check className="h-3.5 w-3.5" /> Mark resolved
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {i.handoffs.length && i.status !== "ESCALATED" ? (
        <div className="border-t border-line px-4 py-3">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-ink">Human handoffs — why, who, what</h3>
          <HandoffList incident={i} handle={handle} canAct={canAct} />
        </div>
      ) : null}
      <div className="border-t border-line px-4 py-3">
        <RequestHelpPanel detail={detail} handle={handle} canRequest={canAct} onBehalf />
        {!canAct ? null : i.status === "GUIDED" && !needs.some((n) => n.path === "COMMUNITY_MISSION" || n.path === "RESOURCE_TRANSFER") ? (
          <p className="text-xs text-muted">Navigator only — no need on this incident calls for a community mission.</p>
        ) : null}
        <a href={mh(`/request/${i.id}`)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
          What the resident sees <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </Card>
  );
}
