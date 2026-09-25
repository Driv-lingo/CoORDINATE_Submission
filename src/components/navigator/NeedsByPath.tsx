import type { Kpis } from "@/domain/dto";
import { RESOLUTION_PATH_LABELS } from "@/domain/catalog";
import { RESOLUTION_PATHS } from "@/domain/types";
import { Card } from "../ui";

/** Needs across the operation by resolution path: most are resolved without dispatching anyone. */
export function NeedsByPath({ kpis }: { kpis: Kpis }) {
  const max = Math.max(1, ...Object.values(kpis.needsByPath));
  const mission = kpis.needsByPath.COMMUNITY_MISSION + kpis.needsByPath.RESOURCE_TRANSFER;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">Needs by resolution path</h3>
        <span className="text-sm text-muted">
          {kpis.needsTotal} needs · {kpis.needsTotal - mission} handled without a volunteer mission · {kpis.needsResolved} resolved so far
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {RESOLUTION_PATHS.map((p) => (
          <li key={p} className="grid grid-cols-[150px_1fr_2rem] items-center gap-2 text-sm">
            <span className="truncate text-ink">{RESOLUTION_PATH_LABELS[p].label}</span>
            <span className="h-3 rounded bg-slate-100">
              <span className="block h-3 rounded bg-brand" style={{ width: `${(kpis.needsByPath[p] / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted">{kpis.needsByPath[p]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

