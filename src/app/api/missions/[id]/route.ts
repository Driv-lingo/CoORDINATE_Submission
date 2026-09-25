import { missionAction } from "@/server/actions";
import { getCtx } from "@/server/context";
import { handle, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** Mission actions: dispatch | start | complete | verify | cancel | ack-route | resume */
export async function POST(req: Request, ctx: RouteContext<"/api/missions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return missionAction(await getCtx(), id, await readJson(req));
  });
}
