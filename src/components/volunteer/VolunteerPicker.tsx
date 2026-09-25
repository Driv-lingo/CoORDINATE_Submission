"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveAccount, useSystem } from "../SystemProvider";
import type { Responder } from "@/domain/types";
import { api, notifyChanged, useApi } from "@/lib/api";

/** The fictional volunteers of the /demo exercise. */
export const VOLUNTEER_CHOICES = [
  { id: "r-jordan", label: "Jordan Reyes — sawyer" },
  { id: "r-priya", label: "Priya Natarajan — CERT" },
  { id: "r-marcus", label: "Marcus Hale — credential pending" },
  { id: "r-luis", label: "Luis Ortega — bilingual, flood cleanup" },
  { id: "r-sarah", label: "Sarah Kim — accessible transport" },
  { id: "r-aisha", label: "Aisha Mohammed — CERT" },
  { id: "r-ben", label: "Ben Carter — roofer" },
  { id: "r-lily", label: "Lily Tran — battery courier" },
  { id: "r-omar", label: "Omar Haddad — credential expired" },
  { id: "r-ethan", label: "Ethan Brooks — unverified sign-up" },
  { id: "r-chloe", label: "Chloe Adams — wellness visitor" },
];

/**
 * Volunteers a viewer can look at. Demo: the fictional roster. Live: a coordinator sees every
 * registered volunteer; anyone else only the profile they registered.
 */
export function useVolunteerChoices(): { id: string; label: string }[] {
  const sys = useSystem();
  const account = useLiveAccount();
  const live = sys.mode === "live";
  const all = useApi<{ responders: Responder[] }>(live && sys.persona.kind === "coordinator" ? "/api/responders" : null, { pollMs: 15000 });
  if (!live) return VOLUNTEER_CHOICES;
  if (sys.persona.kind === "coordinator")
    return (all.data?.responders ?? [])
      .filter((r) => r.kind === "PERSON")
      .map((r) => ({ id: r.id, label: `${r.name}${r.identityVerified ? "" : " — identity not verified"}` }));
  return account.ownVolunteer ? [{ id: account.ownVolunteer.id, label: account.ownVolunteer.name }] : [];
}

/** Which volunteer the page is about: the acting persona, or a chosen one (null when there is none). */
export function useVolunteerSubject(fallback: string | null = "r-jordan"): string | null {
  const sys = useSystem();
  if (sys.persona.kind === "responder") return sys.persona.id;
  return sys.mode === "demo" ? fallback : fallback && fallback !== "r-jordan" ? fallback : null;
}

export function VolunteerPicker({ label = "Sign in as (simulated)" }: { label?: string }) {
  const sys = useSystem();
  const account = useLiveAccount();
  const router = useRouter();
  const current = sys.persona.kind === "responder" ? sys.persona.id : "";
  if (sys.mode === "live") {
    if (sys.persona.kind === "responder") return <span className="text-sm text-muted">Signed in as {sys.persona.name}</span>;
    if (account.ownVolunteer) {
      return (
        <button
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50"
          onClick={async () => {
            await api("/api/persona", { body: { persona: account.ownVolunteer!.id } });
            router.refresh();
            notifyChanged();
          }}
        >
          Sign back in as {account.ownVolunteer.name}
        </button>
      );
    }
    return (
      <Link href="/volunteer" className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
        Register as a volunteer
      </Link>
    );
  }
  return (
    <label className="flex max-w-full flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-muted">{label}</span>
      <select
        className="max-w-full rounded-md border border-line bg-white px-2 py-1.5 font-semibold"
        value={current}
        onChange={async (e) => {
          await api("/api/persona", { body: { persona: e.target.value } });
          router.refresh();
          notifyChanged();
        }}
      >
        {current ? null : <option value="">Choose a volunteer…</option>}
        {VOLUNTEER_CHOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
