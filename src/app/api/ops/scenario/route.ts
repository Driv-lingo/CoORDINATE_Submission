import { getCtx } from "@/server/context";
import { handle, readJson } from "@/server/http";
import { injectScenario } from "@/server/ops";

export const dynamic = "force-dynamic";

/** Coordinator-only scenario controls (exercise workspaces only): { inject: "collision-closure" | … } */
export async function POST(req: Request) {
  return handle(async () => injectScenario(await getCtx(), await readJson(req)));
}
