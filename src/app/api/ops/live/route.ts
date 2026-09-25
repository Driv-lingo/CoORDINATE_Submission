import { getCtx } from "@/server/context";
import { handle } from "@/server/http";
import { buildLiveView } from "@/server/ops";

export const dynamic = "force-dynamic";

/** Read-only Live Virginia awareness view with provider health. Never affects missions. */
export async function GET() {
  return handle(async () => buildLiveView(await getCtx()));
}
