import { getCtx } from "@/server/context";
import { handle } from "@/server/http";
import { buildOpsView, maybeReassess } from "@/server/ops";

export const dynamic = "force-dynamic";

/** Common operational picture for this workspace (reassesses active missions if due). */
export async function GET() {
  return handle(async () => {
    const ctx = await getCtx();
    const changes = await maybeReassess(ctx);
    return buildOpsView(ctx, changes);
  });
}
