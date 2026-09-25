import { getCtx } from "@/server/context";
import { handle, readJson } from "@/server/http";
import { reviewEvent } from "@/server/ops";

export const dynamic = "force-dynamic";

/** Coordinator review of an operational event: { action: "confirm" | "dispute" | "clear", note? } */
export async function POST(req: Request, ctx: RouteContext<"/api/ops/events/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return reviewEvent(await getCtx(), id, await readJson(req));
  });
}
