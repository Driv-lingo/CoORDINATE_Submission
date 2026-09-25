/**
 * Server start-up hook (Next.js instrumentation). Starts the live-feed ingest loop that keeps
 * the /live workspace current: NWS and any configured Virginia feeds are polled server-side on
 * their own intervals (NWS every 60 s), normalized, deduplicated and stored with provenance.
 *
 * /demo never depends on this loop: scenario workspaces read only their own simulated data.
 * Set COORDINATE_LIVE_INGEST=false to disable polling (the /live page then polls on read).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.COORDINATE_LIVE_INGEST === "false" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startLiveIngest } = await import("./live/scheduler");
  startLiveIngest();
}
