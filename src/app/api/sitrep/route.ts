import { generateSitrep } from "@/ai";
import { NEED_LABELS, HAZARD_LABELS } from "@/domain/catalog";
import { getCtx } from "@/server/context";
import { handle } from "@/server/http";
import { buildOpsView } from "@/server/ops";
import { buildSnapshot } from "@/server/views";

export const dynamic = "force-dynamic";

/** AI-written situation report from deterministic statistics (non-safety-critical language task). */
export async function GET() {
  return handle(async () => {
    const ctx = await getCtx();
    const s = await buildSnapshot(ctx);
    const open = s.incidents.filter((i) => i.status === "OPEN" || i.status === "TEAM_FORMING");
    const needCount = new Map<string, number>();
    for (const i of open) for (const n of i.needs) needCount.set(NEED_LABELS[n], (needCount.get(NEED_LABELS[n]) ?? 0) + 1);
    const hazardCount = new Map<string, number>();
    for (const i of s.incidents.filter((x) => x.status === "ESCALATED")) for (const h of i.hazards) hazardCount.set(HAZARD_LABELS[h], (hazardCount.get(HAZARD_LABELS[h]) ?? 0) + 1);
    const stats = {
      operation: s.operation,
      counts: s.counts as Record<string, number>,
      peopleHelped: s.kpis.peopleHelped,
      unmetPeople: s.kpis.peopleWaiting,
      topNeeds: [...needCount.entries()].map(([need, count]) => ({ need, count })).sort((a, b) => b.count - a.count),
      gaps: s.gaps.map((g) => `${g.role} (${g.incidents})`),
      escalations: [...hazardCount.entries()].map(([hazard, count]) => ({ hazard, count })),
      p1Open: open.filter((i) => i.priority === "P1").map((i) => `${i.number} ${i.summary}`),
      activeVolunteers: s.kpis.volunteersDeployed,
      ...(await opsStats(ctx)),
    };
    const report = await generateSitrep(stats);
    return { ...report, generatedAt: ctx.now.toISOString() };
  });
}

async function opsStats(ctx: Awaited<ReturnType<typeof getCtx>>) {
  const v = await buildOpsView(ctx);
  return {
    conditions: v.clusters
      .filter((c) => !c.stale && (c.status === "AUTHORITATIVE" || c.status === "CORROBORATED") && c.actionableEffects.some((e) => e.kind !== "ADVISORY"))
      .map((c) => ({ title: c.title, status: c.status.toLowerCase(), effect: c.actionableEffects.map((e) => e.kind.replace(/_/g, " ").toLowerCase()).join(", "), simulated: c.simulated })),
    heldMissions: v.missions.filter((m) => m.status === "ON_HOLD").map((m) => `${m.code} ${m.title} (${m.hold?.ruleId}${m.hold?.conditionCleared ? ", condition cleared" : ""})`),
    reroutedMissions: v.missions.filter((m) => m.previousRoute).map((m) => `${m.code} ETA ${m.previousRoute!.etaMinutes}→${m.route?.etaMinutes} min`),
    unverifiedReports: v.summary.pendingReview,
  };
}
