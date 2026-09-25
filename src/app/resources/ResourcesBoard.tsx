"use client";

import { Building2, Check, Clock, Package, Search, ShieldCheck, Users, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Callout, Card, CardHeader, Pill, Stat } from "@/components/ui";
import { ASSET_LABELS, CREDENTIAL_LABELS, ROLE_LABELS, SKILL_LABELS } from "@/domain/catalog";
import type { ResponderLite, Snapshot } from "@/domain/dto";
import type { AssetType, Responder } from "@/domain/types";
import { api, notifyChanged, useApi, useOnChanged } from "@/lib/api";
import { useSystem } from "@/components/SystemProvider";
import { cn } from "@/lib/format";

interface ResourcesResponse {
  responders: Responder[];
  lite: ResponderLite[];
  busy: Record<string, string>;
  assetCommitted: Record<string, number>;
}

export default function ResourcesBoard() {
  const q = useApi<ResourcesResponse>("/api/responders", { pollMs: 8000 });
  const snap = useApi<Snapshot>("/api/snapshot", { pollMs: 8000 });
  useOnChanged(
    useCallback(() => {
      void q.refresh();
      void snap.refresh();
    }, [q.refresh, snap.refresh]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [filter, setFilter] = useState("");
  const sys = useSystem();
  const isCoordinator = sys.persona.kind === "coordinator";
  const [verifying, setVerifying] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const verifyIdentity = async (id: string) => {
    setVerifying(id);
    setActionError(null);
    try {
      await api(`/api/responders/${id}`, { body: { action: "verify-identity" } });
      await q.refresh();
      notifyChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setVerifying(null);
    }
  };
  const d = q.data;
  const readiness = useMemo(() => new Map(d?.lite.map((l) => [l.id, l]) ?? []), [d]);

  const inventory = useMemo(() => {
    const map = new Map<AssetType, { total: number; committed: number; providers: Set<string> }>();
    for (const r of d?.responders ?? []) {
      for (const a of r.assets) {
        const e = map.get(a.type) ?? { total: 0, committed: 0, providers: new Set<string>() };
        e.total += a.quantity;
        e.committed += d?.assetCommitted[a.id] ?? 0;
        e.providers.add(r.name);
        map.set(a.type, e);
      }
    }
    return [...map.entries()].sort((a, b) => ASSET_LABELS[a[0]].localeCompare(ASSET_LABELS[b[0]]));
  }, [d]);

  if (!d) return <div className="p-8 text-center text-muted">{q.error ?? "Loading community capacity…"}</div>;
  const people = d.responders.filter((r) => r.kind === "PERSON");
  const orgs = d.responders.filter((r) => r.kind === "ORGANIZATION");
  const f = filter.trim().toLowerCase();
  const shown = people.filter((p) => !f || `${p.name} ${p.headline} ${p.locality} ${p.skills.join(" ")}`.toLowerCase().includes(f));
  const now = new Date();

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Community capacity</h1>
        <p className="max-w-3xl text-muted">
          The people, organizations and equipment CoORDINATE can mobilize — with verification status, current deployments and gaps. This is the capacity that
          usually goes unused because no one can see it or match it safely.
        </p>
      </div>

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
        <Stat label="Registered volunteers" value={people.length} />
        <Stat label="Identity verified" value={people.filter((p) => p.identityVerified).length} tone="done" />
        <Stat label="Deployed now" value={Object.keys(d.busy).length} tone="active" />
        <Stat label="Partner organizations" value={orgs.length} tone="brand" />
        <Stat label="Equipment types" value={inventory.length} />
      </Card>
      {actionError ? <Callout tone="danger" title={actionError} /> : null}
      {!people.length && !orgs.length ? (
        <Callout tone="info" title="No volunteers or organizations registered yet">
          Volunteers register on Offer help. A coordinator then verifies their identity here and their credentials on Preparedness.
        </Callout>
      ) : null}

      {snap.data?.gaps.length ? (
        <Callout tone="warn" title="Capability gaps right now">
          {snap.data.gaps.map((g) => `${g.role} (${g.incidents} open request${g.incidents > 1 ? "s" : ""})`).join(" · ")} — recruit, verify a pending credential, or request mutual aid.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        <Card aria-labelledby="people-h">
          <CardHeader
            id="people-h"
            icon={<Users className="h-4 w-4 text-forming" />}
            title="People"
            right={
              <label className="relative block">
                <span className="sr-only">Filter people</span>
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted" aria-hidden />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, skill, area" className="w-40 rounded-md border border-line py-1.5 pl-7 pr-2 text-sm sm:w-56" />
              </label>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Volunteer</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Readiness</th>
                  <th className="px-3 py-2">Skills</th>
                  <th className="px-3 py-2">Credentials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((p) => {
                  const busy = d.busy[p.id];
                  const rl = readiness.get(p.id);
                  return (
                    <tr key={p.id} className="align-top">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-ink">{p.name}</div>
                        <div className="text-xs text-muted">
                          {ROLE_LABELS[p.role]} · {p.locality}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {!p.identityVerified ? (
                          <span className="flex flex-col items-start gap-1">
                            <Pill className="bg-life-soft text-life">unverified</Pill>
                            {isCoordinator ? (
                              <button
                                className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
                                disabled={verifying === p.id}
                                onClick={() => void verifyIdentity(p.id)}
                                title="Confirm you checked this person's identity (e.g. photo ID in person)"
                              >
                                {verifying === p.id ? "Verifying…" : "Verify identity"}
                              </button>
                            ) : null}
                          </span>
                        ) : busy ? (
                          <Pill className="bg-active-soft text-active">on {busy}</Pill>
                        ) : p.availability.status === "UNAVAILABLE" ? (
                          <Pill className="bg-slate-100 text-slate-600">off duty</Pill>
                        ) : p.availability.status === "LIMITED" ? (
                          <Pill className="bg-trained-soft text-trained">limited</Pill>
                        ) : (
                          <Pill className="bg-done-soft text-done">available</Pill>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        L{rl?.readinessLevel} · {rl?.readinessName}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {p.skills.map((s) => (
                            <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                              {SKILL_LABELS[s]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ul className="space-y-0.5 text-xs">
                          {p.credentials.map((c) => {
                            const expired = c.status === "VERIFIED" && c.expiresAt && new Date(c.expiresAt) < now;
                            const ok = c.status === "VERIFIED" && !expired;
                            return (
                              <li key={c.type} className={cn("flex items-center gap-1", ok ? "text-ink" : "text-life")}>
                                {ok ? <Check className="h-3 w-3 text-done" /> : c.status === "PENDING" ? <Clock className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                {CREDENTIAL_LABELS[c.type]}
                                {!ok ? ` (${expired ? "expired" : c.status.toLowerCase()})` : ""}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card aria-labelledby="inv-h">
            <CardHeader id="inv-h" icon={<Package className="h-4 w-4 text-brand" />} title="Equipment & supplies" subtitle="Committed = in use on active missions." />
            <ul className="divide-y divide-line text-sm">
              {inventory.map(([type, e]) => {
                const free = e.total - e.committed;
                return (
                  <li key={type} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{ASSET_LABELS[type]}</span>
                      <span className="font-mono text-xs">
                        <span className={free > 0 ? "text-done" : "text-life"}>{free} free</span> / {e.total}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100" aria-hidden>
                      <div className="h-full bg-active" style={{ width: `${e.total ? (e.committed / e.total) * 100 : 0}%` }} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{[...e.providers].join(", ")}</div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card aria-labelledby="org-h">
            <CardHeader id="org-h" icon={<Building2 className="h-4 w-4 text-slate-600" />} title="Partner organizations" />
            <ul className="divide-y divide-line text-sm">
              {orgs.map((o) => (
                <li key={o.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{o.name}</span>
                    <Pill className="bg-slate-100 text-slate-700">{ROLE_LABELS[o.role]}</Pill>
                    {o.identityVerified ? <ShieldCheck className="ml-auto h-4 w-4 text-done" aria-label="Verified organization" /> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {o.headline} · {o.locality} · serves {o.maxTravelKm} km
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {o.assets.map((a) => (
                      <span key={a.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                        {a.label} × {a.quantity}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
