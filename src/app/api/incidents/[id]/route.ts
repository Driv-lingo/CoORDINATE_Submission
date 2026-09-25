import { incidentAction } from "@/server/actions";
import { getCtx, HttpError } from "@/server/context";
import { handle, readJson } from "@/server/http";
import { maybeReassess } from "@/server/ops";
import { buildIncidentDetail } from "@/server/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/incidents/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await getCtx();
    await maybeReassess(c);
    const detail = await buildIncidentDetail(c, id);
    if (!detail) throw new HttpError(404, "Incident not found");
    return detail;
  });
}

/** Incident actions: propose | ack-advisory | record-contact | record-ack | clear-hazard | set-needs | offer */
export async function POST(req: Request, ctx: RouteContext<"/api/incidents/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await getCtx();
    const result = await incidentAction(c, id, await readJson(req));
    return { ...result, detail: await buildIncidentDetail(c, id) };
  });
}
