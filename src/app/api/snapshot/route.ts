import { getCtx } from "@/server/context";
import { handle } from "@/server/http";
import { maybeReassess } from "@/server/ops";
import { buildSnapshot } from "@/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const ctx = await getCtx();
    await maybeReassess(ctx);
    return buildSnapshot(ctx);
  });
}
