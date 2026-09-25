"use client";

import { AlertTriangle, Info, Phone, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { OpsMap, type MapShape } from "@/components/Map";
import { SimBadge, VerificationBadge } from "@/components/ops/OpsPanels";
import { Callout, Card, CardHeader } from "@/components/ui";
import type { PublicHazard } from "@/domain/dto";
import { useApi } from "@/lib/api";
import { clock, timeAgo } from "@/lib/format";

const EFFECT_PUBLIC: Record<string, string> = {
  BLOCKS_ROAD: "Road blocked — find another way",
  SLOWS_ROAD: "Expect delays",
  HOLD_ALL_ACTIVITY: "Take shelter now",
  HOLD_OUTDOOR_WORK: "Stay indoors, away from trees",
  AVOID_AREA: "Avoid the area",
  NO_CIVILIAN_ENTRY: "Do not enter",
  ADVISORY: "Be aware",
};

const COLOR: Record<string, string> = {
  TORNADO_WARNING: "#b42318",
  SEVERE_THUNDERSTORM_WARNING: "#c2410c",
  HIGH_WIND: "#c2410c",
  FLASH_FLOOD_WARNING: "#1d4ed8",
  EVACUATION: "#7e22ce",
  HAZMAT: "#7e22ce",
  FIRE: "#b42318",
};

/**
 * Public hazard map. Only official or corroborated conditions appear.
 * No volunteers, residents, requests, missions or private cameras — ever.
 */
export default function PublicHazardMap() {
  const q = useApi<{ mode: string; generatedAt: string; hazards: PublicHazard[] }>("/api/public/hazards", { pollMs: 30000 });
  const hazards = useMemo(() => q.data?.hazards ?? [], [q.data]);
  const shapes: MapShape[] = useMemo(
    () =>
      hazards.map((h) => ({
        id: h.id,
        geometry: h.geometry,
        color: COLOR[h.type] ?? (h.effects.includes("BLOCKS_ROAD") ? "#b42318" : "#a15c07"),
        fillOpacity: h.geometry.type === "Point" ? 0.35 : h.type === "FLASH_FLOOD_WARNING" ? 0.06 : 0.14,
        radiusM: 150,
        label: `${h.title} — ${h.effects.map((e) => EFFECT_PUBLIC[e]).join("; ")}`,
      })),
    [hazards],
  );
  const simulated = hazards.some((h) => h.simulated) || q.data?.mode === "SCENARIO";

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 px-3 py-4 sm:px-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">Hazard map</h1>
        <p className="text-sm text-muted">Official alerts and conditions confirmed by more than one source. {q.data ? `Updated ${timeAgo(q.data.generatedAt)}.` : ""}</p>
      </div>
      <a href="tel:911" className="flex items-center justify-center gap-2 rounded-md bg-life px-4 py-3 text-lg font-bold text-white hover:bg-red-800">
        <Phone className="h-5 w-5" /> In danger right now? Call 911
      </a>
      {q.data && !simulated ? (
        <Callout tone="info" title="Live — real Virginia conditions">
          Official alerts as published by their sources (National Weather Service first; VDOT and others when connected), plus conditions confirmed by more than one
          independent report. {hazards.length ? "" : "No active official hazards right now."} Source status:{" "}
          <a className="font-semibold underline" href="/live">
            live feeds
          </a>
          .
        </Callout>
      ) : null}
      {simulated ? (
        <Callout tone="warn" title="Exercise data — not real conditions">
          This map shows the fictional TS Delphine exercise. Every item is simulated. For real conditions use official sources such as the National Weather Service and Virginia 511.
        </Callout>
      ) : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <OpsMap
            markers={[]}
            shapes={shapes}
            center={simulated ? { lat: 37.262, lng: -79.97 } : { lat: 37.55, lng: -78.8 }}
            zoom={simulated ? 12 : 7}
            fit={shapes.length > 0}
            fitKey={`${q.data?.mode ?? ""}-${shapes.length}`}
            className="h-[60vh] min-h-[360px] w-full"
            ariaLabel="Map of official and corroborated hazards"
          />
        </Card>
        <Card aria-labelledby="hz-h">
          <CardHeader id="hz-h" icon={<AlertTriangle className="h-4 w-4 text-life" />} title={`Current conditions (${hazards.length})`} />
          {hazards.length ? (
            <ul className="divide-y divide-line">
              {hazards.map((h) => (
                <li key={h.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1">
                    <VerificationBadge status={h.status} />
                    {h.simulated ? <SimBadge /> : null}
                  </div>
                  <div className="mt-0.5 font-semibold text-ink">{h.title}</div>
                  <div className="font-semibold text-life">{h.effects.map((e) => EFFECT_PUBLIC[e]).join(" · ")}</div>
                  <div className="text-xs text-muted">
                    Sources: {h.sources.join(", ")}
                    {h.expiresAt ? ` · until ${clock(h.expiresAt)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted">{q.data ? "No official or corroborated conditions right now." : "Loading…"}</p>
          )}
          <div className="space-y-1 border-t border-line bg-slate-50 px-4 py-2.5 text-xs text-muted">
            <p className="flex gap-1.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Unverified posts and single reports are not shown here until another source confirms them.
            </p>
            <p className="flex gap-1.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This map never shows people, requests for help or volunteer locations.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
