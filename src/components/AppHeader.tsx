"use client";

import { Cpu, Database, Map as MapIcon, Menu, Radio, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signInAs } from "@/lib/persona";
import { notifyChanged } from "@/lib/api";
import { cn } from "@/lib/format";
import { useLiveAccount, useSystem } from "./SystemProvider";

/** The live site: real requests, real volunteers, real Virginia feeds. */
const LIVE_NAV = [
  { href: "/request", label: "Get help" },
  { href: "/volunteer", label: "Offer help" },
  { href: "/ops", label: "Operations" },
  { href: "/map", label: "Hazard map" },
  { href: "/live", label: "Live feeds" },
  { href: "/resources", label: "Resources" },
  { href: "/preparedness", label: "Preparedness" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/demo", label: "Guided demo" },
];

/** Inside /demo: the same screens on this browser's simulated exercise. */
const DEMO_NAV = [
  { href: "/demo", label: "Guided demo", exact: true },
  { href: "/demo/request", label: "Get help" },
  { href: "/demo/volunteer", label: "Volunteers" },
  { href: "/demo/ops", label: "Operations" },
  { href: "/demo/map", label: "Hazard map" },
  { href: "/demo/resources", label: "Resources" },
  { href: "/demo/preparedness", label: "Preparedness" },
  { href: "/", label: "Exit exercise →", exact: true },
];

export interface PersonaOption {
  value: string;
  label: string;
  group: "Coordinator" | "Resident" | "Volunteers";
}

export function AppHeader({ personas }: { personas: PersonaOption[] }) {
  const sys = useSystem();
  const pathname = usePathname();
  const live = sys.mode === "live";
  const account = useLiveAccount();
  const NAV: { href: string; label: string; exact?: boolean }[] = live ? LIVE_NAV : DEMO_NAV;
  const isCurrent = (n: { href: string; exact?: boolean }) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`));
  const options: PersonaOption[] = live
    ? [
        { value: "coordinator", label: account.passcodeRequired ? "Coordinator (passcode)" : "Coordinator", group: "Coordinator" },
        { value: "resident", label: "Resident (you)", group: "Resident" },
        ...(account.ownVolunteer ? [{ value: account.ownVolunteer.id, label: account.ownVolunteer.name, group: "Volunteers" as const }] : []),
      ]
    : personas;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const current = sys.persona.kind === "coordinator" ? "coordinator" : sys.persona.kind === "resident" ? "resident" : sys.persona.id;

  const switchPersona = async (value: string) => {
    if (!(await signInAs(value))) return;
    start(() => router.refresh());
    notifyChanged();
  };

  return (
    <header className="sticky top-0 z-[1000] bg-ink text-white shadow-md">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded" aria-label="CoORDINATE home">
          <Logo />
          <span className="text-lg font-bold tracking-tight">
            Co<span className="text-[#7cc4ff]">ORDINATE</span>
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isCurrent(n) ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap rounded px-2.5 py-1.5 text-sm font-medium text-slate-200 hover:bg-ink-3 hover:text-white",
                    isCurrent(n) && "bg-ink-3 text-white",
                  )}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <label className="ml-auto flex items-center gap-2 text-xs text-slate-300 xl:ml-2">
          <span className="hidden 2xl:inline">Acting as</span>
          <select
            value={current}
            onChange={(e) => void switchPersona(e.target.value)}
            disabled={pending}
            className="max-w-[8.5rem] rounded border border-ink-3 bg-ink-2 px-2 py-1.5 text-sm font-semibold text-white sm:max-w-[11rem]"
            aria-label="Switch persona (simulated sign-in)"
          >
            {(["Coordinator", "Resident", "Volunteers"] as const).map((g) => (
              <optgroup key={g} label={g}>
                {options
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        <button className="rounded p-1.5 hover:bg-ink-3 xl:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div className="hidden border-t border-ink-3 bg-ink-2 md:block">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1 text-[11px] text-slate-300">
          {live ? (
            <span className="font-semibold text-white">
              {sys.operation} · <span className="text-emerald-300">real requests, volunteers and public feeds</span>
            </span>
          ) : (
            <span className="font-semibold text-white">
              {sys.operation} · <span className="text-amber-300">Fictional exercise</span>
            </span>
          )}
          <ProviderChip icon={<Cpu className="h-3 w-3" />} label="AI" value={sys.ai.provider === "azure-ai-foundry" ? `Azure AI Foundry · ${sys.ai.model}` : "Local rules interpreter (Foundry not configured)"} on={sys.ai.provider === "azure-ai-foundry"} />
          <ProviderChip icon={<Database className="h-3 w-3" />} label="Data" value={sys.data === "cosmos" ? "Azure Cosmos DB" : "In-memory store"} on={sys.data === "cosmos"} />
          <ProviderChip icon={<MapIcon className="h-3 w-3" />} label="Maps" value={sys.maps === "azure-maps" ? "Azure Maps" : "OpenStreetMap fallback"} on={sys.maps === "azure-maps"} />
          <ProviderChip icon={<Radio className="h-3 w-3" />} label="Updates" value={sys.realtime === "azure-web-pubsub" ? "Azure Web PubSub (live)" : "Polling (5 s)"} on={sys.realtime === "azure-web-pubsub"} />
          {live ? null : <span className="ml-auto text-slate-400">Sandbox {sys.workspace.slice(0, 12)}</span>}
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-ink-3 bg-ink-2 xl:hidden">
          <ul className="mx-auto grid max-w-[1600px] grid-cols-2 gap-1 p-2 sm:grid-cols-4">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={isCurrent(n) ? "page" : undefined}
                  className={cn("block rounded px-3 py-2 text-sm font-medium hover:bg-ink-3", isCurrent(n) && "bg-ink-3")}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

function ProviderChip({ icon, label, value, on }: { icon: React.ReactNode; label: string; value: string; on: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-emerald-400" : "bg-slate-400")} aria-hidden />
      {icon}
      <span className="font-semibold text-slate-200">{label}:</span> {value}
    </span>
  );
}

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0f5fbf" />
      <circle cx="16" cy="16" r="4" fill="#fff" />
      <circle cx="8" cy="9" r="2.6" fill="#7cc4ff" />
      <circle cx="24" cy="9" r="2.6" fill="#7cc4ff" />
      <circle cx="8" cy="23" r="2.6" fill="#7cc4ff" />
      <circle cx="24" cy="23" r="2.6" fill="#f5b400" />
      <path d="M9.8 10.6 13.4 14M22.2 10.6 18.6 14M9.8 21.4 13.4 18M22.2 21.4 18.6 18" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
