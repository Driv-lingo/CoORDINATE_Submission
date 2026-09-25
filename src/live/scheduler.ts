import { refreshDue } from "@/providers/registry";

const TICK_MS = 15_000;
const g = globalThis as unknown as { __coordinateIngestTimer?: ReturnType<typeof setInterval> };

/** Poll due live providers on a timer (each provider keeps its own interval and back-off). */
export function startLiveIngest(): void {
  if (g.__coordinateIngestTimer) return;
  const tick = () => {
    refreshDue(new Date()).catch((err) => console.warn("[coordinate] live ingest tick failed", (err as Error).message));
  };
  g.__coordinateIngestTimer = setInterval(tick, TICK_MS);
  g.__coordinateIngestTimer.unref?.();
  tick();
}
