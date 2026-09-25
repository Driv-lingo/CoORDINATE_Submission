import { getCtx } from "@/server/context";
import { handle, readJson } from "@/server/http";
import { cameraAction } from "@/server/ops";

export const dynamic = "force-dynamic";

/** Camera actions: { action: "snapshot", incidentId? } (coordinator, consent-checked) | { action: "revoke" } (owner). */
export async function POST(req: Request, ctx: RouteContext<"/api/cameras/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return cameraAction(await getCtx(), id, await readJson(req));
  });
}
