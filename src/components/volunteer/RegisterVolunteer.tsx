"use client";

import { HandHelping } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Callout, Card, CardHeader } from "@/components/ui";
import { ASSET_LABELS, SKILL_LABELS } from "@/domain/catalog";
import { SKILLS, type AssetType, type Skill } from "@/domain/types";
import { api, notifyChanged } from "@/lib/api";
import { cn } from "@/lib/format";

/** Equipment a volunteer might bring. Supplies, beds and refrigeration are offered by organizations. */
const VOLUNTEER_EQUIPMENT: AssetType[] = ["PICKUP_TRUCK", "TRAILER", "CHAINSAW", "GENERATOR", "PORTABLE_BATTERY", "PASSENGER_VEHICLE", "ACCESSIBLE_VAN", "HAND_TOOLS", "TARPS", "WATER_PUMP", "WET_VAC", "LADDER"];

/**
 * Live operation: a volunteer registers themselves. The profile starts unverified: a
 * coordinator verifies identity and any credentials before the matching gates select them.
 */
export function RegisterVolunteer() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [locationText, setLocation] = useState("");
  const [radius, setRadius] = useState(25);
  const [skills, setSkills] = useState<Set<Skill>>(new Set(["GENERAL_LABOR"]));
  const [equipment, setEquipment] = useState<Set<AssetType>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    apply(n);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/responders", {
        body: { name, locationText, maxTravelKm: radius, skills: [...skills], assets: [...equipment].map((type) => ({ type, quantity: 1 })) },
      });
      router.refresh();
      notifyChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card aria-labelledby="reg-h">
      <CardHeader id="reg-h" icon={<HandHelping className="h-4 w-4 text-brand" />} title="Register as a volunteer" subtitle="You'll only ever be offered requests you are qualified and cleared for." />
      <div className="space-y-4 p-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="font-semibold">Your name</span>
            <input className="mt-1 w-full rounded border border-line px-2 py-1.5" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="block">
            <span className="font-semibold">Where you start from</span>
            <input className="mt-1 w-full rounded border border-line px-2 py-1.5" value={locationText} maxLength={160} onChange={(e) => setLocation(e.target.value)} placeholder="Street address or town, VA" />
          </label>
          <label className="block">
            <span className="font-semibold">How far you&apos;ll travel</span>
            <select className="mt-1 w-full rounded border border-line px-2 py-1.5" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {[5, 10, 15, 25, 40, 60].map((k) => (
                <option key={k} value={k}>
                  {k} km
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="font-semibold">What you can do</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {SKILLS.map((k) => (
              <button type="button" key={k} aria-pressed={skills.has(k)} onClick={() => toggle(skills, k, setSkills)} className={cn("rounded-full border px-2.5 py-1", skills.has(k) ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line")}>
                {SKILL_LABELS[k]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">Equipment you can bring</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {VOLUNTEER_EQUIPMENT.map((k) => (
              <button type="button" key={k} aria-pressed={equipment.has(k)} onClick={() => toggle(equipment, k, setEquipment)} className={cn("rounded-full border px-2.5 py-1", equipment.has(k) ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line")}>
                {ASSET_LABELS[k]}
              </button>
            ))}
          </div>
        </fieldset>
        <Callout tone="info">
          Skills are self-reported. A coordinator verifies your identity, and credentials such as chainsaw safety or a background check, before you can be
          assigned. Add credential records and short training modules on the Preparedness page after registering.
        </Callout>
        {error ? <Callout tone="danger" title={error} /> : null}
        <Button size="lg" busy={busy} disabled={name.trim().length < 2 || locationText.trim().length < 2} onClick={() => void submit()}>
          Register
        </Button>
      </div>
    </Card>
  );
}
