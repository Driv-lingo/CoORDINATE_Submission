"use client";

import {
  AlertOctagon,
  Camera,
  LocateFixed,
  Phone,
  Send,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { CATEGORY_LABELS } from "@/domain/catalog";
import {
  INCIDENT_CATEGORIES,
  type Incident,
  type IncidentCategory,
  type Vulnerability,
} from "@/domain/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button, Callout } from "./ui";

export interface IntakeValues {
  text: string;
  categoryHint: IncidentCategory | "";
  locationText: string;
  location?: { lat: number; lng: number };
  peopleAffected: string;
  accessibilityNeeds: Vulnerability[];
  immediateDanger: boolean;
  language: string;
  photoDataUrl?: string;
  reporterName: string;
  reporterRelation: "SELF" | "FAMILY" | "NEIGHBOR" | "OTHER";
}

export const EMPTY_INTAKE: IntakeValues = {
  text: "",
  categoryHint: "",
  locationText: "",
  peopleAffected: "",
  accessibilityNeeds: [],
  immediateDanger: false,
  language: "en",
  reporterName: "",
  reporterRelation: "SELF",
};

const ACCESS_OPTIONS: { v: Vulnerability; label: string }[] = [
  { v: "MOBILITY_LIMITED", label: "Wheelchair, walker or limited mobility" },
  {
    v: "MEDICAL_DEPENDENCY",
    label: "Relies on medical equipment or medication",
  },
  { v: "OLDER_ADULT", label: "Older adult (65+)" },
  { v: "CHILDREN", label: "Infants or children" },
  { v: "ISOLATED", label: "Lives alone" },
  { v: "DISABILITY_OTHER", label: "Deaf, blind, or cognitive disability" },
];

const LANGUAGES = [
  { v: "en", label: "English" },
  { v: "es", label: "Español" },
  { v: "vi", label: "Tiếng Việt" },
  { v: "ar", label: "العربية" },
  { v: "zh", label: "中文" },
  { v: "ko", label: "한국어" },
];

async function resizeImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function IntakeForm({
  initial,
  onSubmitted,
  submitLabel = "Get guidance",
  examples,
}: {
  initial?: Partial<IntakeValues>;
  onSubmitted: (incident: Incident) => void;
  submitLabel?: string;
  examples?: {
    label: string;
    values: Partial<IntakeValues>;
    tone?: "danger";
  }[];
}) {
  const [v, setV] = useState<IntakeValues>({ ...EMPTY_INTAKE, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const id = useId();
  const set = <K extends keyof IntakeValues>(k: K, val: IntakeValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        text: v.text,
        categoryHint: v.categoryHint || undefined,
        locationText: v.locationText,
        location: v.location,
        peopleAffected: v.peopleAffected ? Number(v.peopleAffected) : undefined,
        accessibilityNeeds: v.accessibilityNeeds,
        immediateDanger: v.immediateDanger,
        language: v.language,
        photoDataUrl: v.photoDataUrl,
        reporterName: v.reporterName || undefined,
        reporterRelation: v.reporterRelation,
      };
      const res = await api<{ incident: Incident }>("/api/incidents", { body });
      onSubmitted(res.incident);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const locate = () => {
    if (!navigator.geolocation)
      return setError("Location is not available on this device.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setV((s) => ({
          ...s,
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          locationText: s.locationText || "My current location",
        }));
        setLocating(false);
      },
      () => {
        setError(
          "Could not get your location. Please type a nearby street, neighborhood or ZIP code.",
        );
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-describedby={`${id}-911`}
    >
      <div
        id={`${id}-911`}
        className="flex items-center gap-3 rounded-md bg-life px-3 py-2 text-sm font-semibold text-white"
      >
        <Phone className="h-5 w-5 shrink-0" aria-hidden />
        If anyone is injured, trapped, or in danger right now — call 911 first.
      </div>

      {examples?.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Try an example:</span>
          {examples.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setV({ ...EMPTY_INTAKE, ...ex.values })}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold ring-1",
                ex.tone === "danger"
                  ? "bg-life-soft text-life ring-life/30 hover:bg-red-100"
                  : "bg-brand-soft text-brand ring-brand/30 hover:bg-blue-100",
              )}
            >
              {ex.label}
            </button>
          ))}
        </div>
      ) : null}

      <div>
        <label
          htmlFor={`${id}-text`}
          className="block text-sm font-semibold text-ink"
        >
          What&apos;s happening?{" "}
          <span className="font-normal text-muted">Use your own words.</span>{" "}
          <span className="text-life">*</span>
        </label>
        <textarea
          id={`${id}-text`}
          required
          minLength={8}
          rows={4}
          value={v.text}
          onChange={(e) => set("text", e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base leading-relaxed"
          placeholder="Example: My basement is flooding and my father can't walk up the stairs."
        />
      </div>

      <div>
        <div>
          <label
            htmlFor={`${id}-loc`}
            className="block text-sm font-semibold text-ink"
          >
            Approximate location <span className="text-life">*</span>
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={`${id}-loc`}
              required
              value={v.locationText}
              onChange={(e) =>
                setV((s) => ({
                  ...s,
                  locationText: e.target.value,
                  location: undefined,
                }))
              }
              className="min-w-0 flex-1 rounded-md border border-line px-3 py-2"
              placeholder="Neighborhood, street or ZIP"
              autoComplete="address-level2"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={locate}
              busy={locating}
              title="Use my location"
            >
              <LocateFixed className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Locate</span>
            </Button>
          </div>
          {v.location ? (
            <p className="mt-1 text-xs text-done">
              Using device location (approximate).
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Only an approximate area is stored.
            </p>
          )}
        </div>
      </div>

      <label
        className={cn(
          "flex items-start gap-3 rounded-md border-2 px-3 py-2.5",
          v.immediateDanger ? "border-life bg-life-soft" : "border-line",
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5"
          checked={v.immediateDanger}
          onChange={(e) => set("immediateDanger", e.target.checked)}
        />
        <span className="text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-life">
            <AlertOctagon className="h-4 w-4" aria-hidden /> Someone is in
            immediate danger
          </span>
          Injured, trapped, fire, gas smell, downed power lines, or rising
          water. Volunteers will not be sent; this goes to emergency services.
        </span>
      </label>

      <details
        className="group rounded-md border border-line"
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-ink">
          Add details{" "}
          <span className="font-normal text-muted">
            (optional — household needs, language, photo)
          </span>
        </summary>
        <div className="space-y-4 border-t border-line p-3">
          <div className="grid grid-cols-2 gap-3 sm:w-2/3">
            <div>
              <label
                htmlFor={`${id}-people`}
                className="block text-sm font-semibold text-ink"
              >
                People affected
              </label>
              <input
                id={`${id}-people`}
                type="number"
                min={1}
                max={500}
                inputMode="numeric"
                value={v.peopleAffected}
                onChange={(e) => set("peopleAffected", e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2"
              />
            </div>
            <div>
              <label
                htmlFor={`${id}-lang`}
                className="block text-sm font-semibold text-ink"
              >
                Preferred language
              </label>
              <select
                id={`${id}-lang`}
                value={v.language}
                onChange={(e) => set("language", e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-2 py-2"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.v} value={l.v}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor={`${id}-cat`}
              className="block text-sm font-semibold text-ink"
            >
              Type of help{" "}
              <span className="font-normal text-muted">
                (optional — we can work it out)
              </span>
            </label>
            <select
              id={`${id}-cat`}
              value={v.categoryHint}
              onChange={(e) =>
                set("categoryHint", e.target.value as IncidentCategory | "")
              }
              className="mt-1 w-full rounded-md border border-line px-2 py-2 sm:w-1/2"
            >
              <option value="">Not sure</option>
              {INCIDENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Does anyone in the household need extra support?
            </legend>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {ACCESS_OPTIONS.map((o) => (
                <label
                  key={o.v}
                  className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={v.accessibilityNeeds.includes(o.v)}
                    onChange={(e) =>
                      set(
                        "accessibilityNeeds",
                        e.target.checked
                          ? [...v.accessibilityNeeds, o.v]
                          : v.accessibilityNeeds.filter((x) => x !== o.v),
                      )
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="block text-sm font-semibold text-ink">
                Photo (optional)
              </span>
              {v.photoDataUrl ? (
                <div className="mt-1 flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.photoDataUrl}
                    alt="Selected photo preview"
                    className="h-16 w-16 rounded object-cover ring-1 ring-line"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => set("photoDataUrl", undefined)}
                  >
                    <X className="h-4 w-4" /> Remove
                  </Button>
                </div>
              ) : (
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-sm text-muted hover:bg-slate-50">
                  <Camera className="h-4 w-4" aria-hidden /> Add a photo of the
                  damage
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) set("photoDataUrl", await resizeImage(f));
                    }}
                  />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={`${id}-name`}
                  className="block text-sm font-semibold text-ink"
                >
                  Your first name
                </label>
                <input
                  id={`${id}-name`}
                  value={v.reporterName}
                  onChange={(e) => set("reporterName", e.target.value)}
                  className="mt-1 w-full rounded-md border border-line px-3 py-2"
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label
                  htmlFor={`${id}-rel`}
                  className="block text-sm font-semibold text-ink"
                >
                  Reporting for
                </label>
                <select
                  id={`${id}-rel`}
                  value={v.reporterRelation}
                  onChange={(e) =>
                    set(
                      "reporterRelation",
                      e.target.value as IntakeValues["reporterRelation"],
                    )
                  }
                  className="mt-1 w-full rounded-md border border-line px-2 py-2"
                >
                  <option value="SELF">Myself / household</option>
                  <option value="FAMILY">A family member</option>
                  <option value="NEIGHBOR">A neighbor</option>
                  <option value="OTHER">Someone else</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </details>

      {error ? (
        <Callout tone="danger" title="Could not send request">
          {error}
        </Callout>
      ) : null}

      <Button type="submit" size="lg" busy={busy} className="w-full sm:w-auto">
        <Send className="h-4 w-4" />{" "}
        {busy ? "Understanding your situation…" : submitLabel}
      </Button>
    </form>
  );
}
