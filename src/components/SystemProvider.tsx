"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import type { ProviderStatus } from "@/domain/dto";
import type { Persona } from "@/server/context";
import { modeHref } from "@/lib/api";

export interface SystemInfo extends ProviderStatus {
  persona: Persona;
  /** "demo" under /demo (the simulated exercise), otherwise "live" (the real operation). */
  mode: "demo" | "live";
}

export interface SystemBundle {
  demo: Omit<SystemInfo, "mode">;
  live: Omit<SystemInfo, "mode"> & { passcodeRequired: boolean; ownVolunteer?: { id: string; name: string } };
}

const Ctx = createContext<SystemBundle | null>(null);

export function SystemProvider({ value, children }: { value: SystemBundle; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const isDemoPath = (p: string | null) => !!p && (p === "/demo" || p.startsWith("/demo/"));

/** System status and the acting persona for the mode of the current page. */
export function useSystem(): SystemInfo {
  const v = useContext(Ctx);
  const pathname = usePathname();
  if (!v) throw new Error("SystemProvider missing");
  return isDemoPath(pathname) ? { ...v.demo, mode: "demo" } : { ...v.live, mode: "live" };
}

export function useLiveAccount(): SystemBundle["live"] {
  const v = useContext(Ctx);
  if (!v) throw new Error("SystemProvider missing");
  return v.live;
}

/** Link builder that keeps navigation inside the current mode (/demo/... inside the exercise). */
export function useModeHref(): (path: string) => string {
  const { mode } = useSystem();
  return (path) => modeHref(path, mode);
}
