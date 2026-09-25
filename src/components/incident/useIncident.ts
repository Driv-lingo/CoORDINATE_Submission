"use client";

import { useCallback, useState } from "react";
import type { IncidentDetail } from "@/domain/dto";
import { api, ApiError, notifyChanged, useApi, useOnChanged } from "@/lib/api";

export interface ActionState {
  busy: string | null;
  error: string | null;
  errorDetails: unknown;
}

/** Load an incident's full detail and expose typed actions that refresh it. */
export function useIncident(id: string | null, pollMs = 5000) {
  const q = useApi<IncidentDetail>(id ? `/api/incidents/${id}` : null, { pollMs });
  const [state, setState] = useState<ActionState>({ busy: null, error: null, errorDetails: null });
  useOnChanged(useCallback(() => void q.refresh(), [q.refresh])); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setState({ busy: label, error: null, errorDetails: null });
      try {
        await fn();
        await q.refresh();
        notifyChanged();
        setState({ busy: null, error: null, errorDetails: null });
        return true;
      } catch (e) {
        setState({ busy: null, error: (e as Error).message, errorDetails: e instanceof ApiError ? e.details : null });
        await q.refresh();
        return false;
      }
    },
    [q],
  );

  const incidentAction = (body: Record<string, unknown>) => run(String(body.action), () => api(`/api/incidents/${id}`, { body }));
  const missionAction = (missionId: string, action: string, note?: string, extra?: { allowPartial?: boolean }) =>
    run(action, () => api(`/api/missions/${missionId}`, { body: { action, note, ...extra } }));

  return { ...q, ...state, incidentAction, missionAction, clearError: () => setState((s) => ({ ...s, error: null })) };
}

export type IncidentHandle = ReturnType<typeof useIncident>;
