"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Which workspace an API call belongs to: the simulated exercise under /demo, otherwise the live operation. */
export function currentView(): "demo" | "live" {
  if (typeof window === "undefined") return "live";
  const p = window.location.pathname;
  return p === "/demo" || p.startsWith("/demo/") ? "demo" : "live";
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: { "x-coordinate-view": currentView(), ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status, (data as { details?: unknown }).details);
  return data as T;
}

/** Fetch + optional polling while the tab is visible. */
export function useApi<T>(url: string | null, opts: { pollMs?: number } = {}) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const refresh = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const d = await api<T>(u);
      if (urlRef.current === u) setState({ url: u, data: d, error: null });
    } catch (e) {
      if (urlRef.current === u) setState((s) => ({ url: u, data: s.url === u ? s.data : null, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    void refresh();
    if (!opts.pollMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, opts.pollMs);
    return () => clearInterval(t);
  }, [url, opts.pollMs, refresh]);

  // Never show data that belongs to a previous URL.
  const current = state.url === url;
  const data = current ? state.data : null;
  const error = current ? state.error : null;
  return { data, error, loading: !!url && !data && !error, refresh };
}

/** Broadcast that server state changed so other panels refresh immediately. */
export function notifyChanged() {
  window.dispatchEvent(new Event("coordinate:changed"));
}

export function useOnChanged(fn: () => void) {
  useEffect(() => {
    const h = () => fn();
    window.addEventListener("coordinate:changed", h);
    return () => window.removeEventListener("coordinate:changed", h);
  }, [fn]);
}

/** Keep links inside the current mode: under /demo, app screens resolve to their exercise copies. */
export function modeHref(path: string, mode: "demo" | "live"): string {
  if (mode !== "demo") return path;
  return /^\/(ops|request|volunteer|map|preparedness|resources)(\/|$)/.test(path) ? `/demo${path}` : path;
}
