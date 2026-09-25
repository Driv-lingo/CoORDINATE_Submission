"use client";

import { Award, BadgeCheck, BookOpen, Clock, GraduationCap, Info, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useSystem } from "@/components/SystemProvider";
import { Button, Callout, Card, CardHeader, Pill } from "@/components/ui";
import { useVolunteerChoices, useVolunteerSubject, VolunteerPicker } from "@/components/volunteer/VolunteerPicker";
import { CREDENTIAL_LABELS, TRAINING_LABELS } from "@/domain/catalog";
import type { VolunteerView } from "@/domain/dto";
import { CREDENTIAL_TYPES, TRAINING_MODULES, type CredentialType, type TrainingModuleId } from "@/domain/types";
import { READINESS_LEVELS } from "@/engine/readiness";
import { api, notifyChanged, useApi, useOnChanged } from "@/lib/api";
import { cn } from "@/lib/format";

const CREDENTIAL_INFO: Record<CredentialType, string> = {
  BACKGROUND_CHECK: "Required to work on-site with vulnerable households (rule R-V01).",
  DRIVERS_LICENSE: "Required for delivery and transport roles.",
  CHAINSAW_SAFETY: "Required to operate a chainsaw on any mission.",
  ROOF_FALL_PROTECTION: "Required for roof tarping.",
  CERT_BASIC: "Community Emergency Response Team basic training.",
  FIRST_AID_CPR: "Required for the buddy on wellness checks.",
  WHEELCHAIR_SECUREMENT: "Required to transport wheelchair users.",
  LICENSED_ELECTRICIAN: "Trade license. Never qualifies anyone for downed lines — utilities only.",
  FOOD_HANDLER: "For food service at shelters and distribution sites.",
};

export default function Preparedness() {
  const sys = useSystem();
  const choices = useVolunteerChoices();
  const [picked, setPicked] = useState<string | null>(null);
  const pickedByCoordinator = picked ?? (sys.mode === "demo" ? "r-marcus" : (choices[0]?.id ?? null));
  const subject = useVolunteerSubject(pickedByCoordinator);
  const q = useApi<VolunteerView>(subject ? `/api/responders/${subject}` : null);
  useOnChanged(useCallback(() => void q.refresh(), [q.refresh])); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<TrainingModuleId | null>(null);
  const isCoordinator = sys.persona.kind === "coordinator";
  const isSelf = sys.persona.kind === "responder" && sys.persona.id === subject;
  const canEdit = isSelf || isCoordinator;

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await api(`/api/responders/${subject}`, { body });
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
          <h1 className="text-2xl font-bold text-ink">Preparedness</h1>
          <p className="max-w-2xl text-muted">
            Build readiness before the next storm. Short CoORDINATE modules earn internal badges; recognized external credentials are uploaded and verified. Only
            verified external credentials unlock credentialed roles.
          </p>
        </div>
        {isCoordinator ? (
          <label className="flex max-w-full flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-muted">Coordinator reviewing</span>
            <select className="max-w-full rounded-md border border-line bg-white px-2 py-1.5 font-semibold" value={pickedByCoordinator ?? ""} onChange={(e) => setPicked(e.target.value)}>
              {choices.length ? null : <option value="">No volunteers registered yet</option>}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <VolunteerPicker />
        )}
      </div>

      <Callout tone="info" icon={<Info className="h-4 w-4 text-brand" />} title="CoORDINATE does not issue professional certifications">
        Training modules here are awareness and orientation. They earn internal badges and count toward readiness, but a CoORDINATE badge never substitutes for an
        external credential such as chainsaw certification, CERT, or First Aid/CPR.
      </Callout>
      {error ? <Callout tone="danger" title={error} /> : null}

      {!subject ? (
        <Card className="p-8 text-center text-muted">
          {isCoordinator ? "No volunteers have registered yet." : "Register as a volunteer (Offer help) to track your training and credentials here."}
        </Card>
      ) : !v ? (
        <Card className="p-8 text-center text-muted">{q.error ?? "Loading…"}</Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <GraduationCap className="h-6 w-6 text-forming" />
              <div>
                <div className="text-lg font-bold text-ink">{v.responder.name}</div>
                <div className="text-sm text-muted">
                  Readiness level {v.readiness.level} — {v.readiness.name}
                  {v.readiness.next ? ` · next: ${v.readiness.next}` : ""}
                </div>
              </div>
            </div>
            <ol className="mt-3 grid gap-2 sm:grid-cols-5" aria-label="Readiness levels">
              {READINESS_LEVELS.map((l) => (
                <li key={l.level} className={cn("rounded-md border p-2 text-xs", l.level <= v.readiness.level ? "border-forming bg-forming-soft" : "border-line bg-white")}>
                  <div className={cn("font-bold", l.level <= v.readiness.level ? "text-forming" : "text-muted")}>
                    L{l.level} · {l.name}
                  </div>
                  <div className="mt-0.5 text-ink">{l.description}</div>
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card aria-labelledby="mod-h">
              <CardHeader id="mod-h" icon={<BookOpen className="h-4 w-4 text-general" />} title="Training modules" subtitle="Internal badges — completion is recorded, not certified." />
              <ul className="divide-y divide-line">
                {TRAINING_MODULES.map((m) => {
                  const done = v.responder.training.find((t) => t.moduleId === m);
                  const info = TRAINING_LABELS[m];
                  return (
                    <li key={m} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{info.title}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <Clock className="h-3 w-3" /> {info.minutes} min
                        </span>
                        <span className="ml-auto">
                          {done ? (
                            <Pill className="bg-general-soft text-general">
                              <Award className="h-3 w-3" /> Badge earned {done.completedAt.slice(0, 10)}
                            </Pill>
                          ) : canEdit ? (
                            <Button size="sm" variant="secondary" onClick={() => setQuiz(m)}>
                              Start module
                            </Button>
                          ) : null}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{info.summary}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {info.competencies.map((c) => (
                          <Pill key={c} className={done ? "bg-done-soft text-done" : "bg-slate-100 text-slate-600"}>
                            {c}
                          </Pill>
                        ))}
                      </div>
                      {quiz === m ? (
                        <div className="mt-2 rounded-md border border-general/30 bg-general-soft p-3 text-sm">
                          <p className="font-semibold">Knowledge check (simulated)</p>
                          <p className="mt-1">{info.check.q}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" busy={busy === m} onClick={() => void act(m, { action: "complete-training", moduleId: m }).then(() => setQuiz(null))}>
                              {info.check.right}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setError(`Not quite — “${info.check.wrong}” is unsafe. Try again.`)}>
                              {info.check.wrong}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card aria-labelledby="cred-h">
              <CardHeader id="cred-h" icon={<ShieldCheck className="h-4 w-4 text-trained" />} title="External credentials" subtitle="Upload a record; a coordinator or partner registry verifies it." />
              <ul className="divide-y divide-line">
                {CREDENTIAL_TYPES.map((t) => {
                  const c = v.responder.credentials.find((x) => x.type === t);
                  const expired = c?.status === "VERIFIED" && c.expiresAt && new Date(c.expiresAt) < new Date();
                  const state = !c ? "none" : expired ? "expired" : c.status.toLowerCase();
                  return (
                    <li key={t} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{CREDENTIAL_LABELS[t]}</span>
                        <Pill
                          className={cn(
                            "ml-auto",
                            state === "verified" ? "bg-done-soft text-done" : state === "pending" ? "bg-trained-soft text-trained" : state === "expired" ? "bg-life-soft text-life" : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {state === "none" ? "not on file" : state}
                        </Pill>
                      </div>
                      <p className="text-xs text-muted">
                        {CREDENTIAL_INFO[t]}
                        {c ? ` · ${c.issuer}${c.expiresAt ? ` · expires ${c.expiresAt.slice(0, 10)}` : ""}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {isSelf && (state === "none" || state === "expired") ? (
                          <Button size="sm" variant="ghost" busy={busy === `sub-${t}`} onClick={() => void act(`sub-${t}`, { action: "submit-credential", type: t, issuer: "Uploaded certificate — awaiting verification" })}>
                            <Upload className="h-3.5 w-3.5" /> Upload record
                          </Button>
                        ) : null}
                        {isCoordinator && state === "pending" ? (
                          <Button size="sm" variant="success" busy={busy === `ver-${t}`} onClick={() => void act(`ver-${t}`, { action: "verify-credential", type: t })}>
                            <BadgeCheck className="h-3.5 w-3.5" /> Verify record (coordinator)
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
