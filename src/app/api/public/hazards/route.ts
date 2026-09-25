import { getCtx } from "@/server/context";
import { handle } from "@/server/http";
import { buildPublicHazards } from "@/server/ops";

export const dynamic = "force-dynamic";

/** Public hazard map data: actionable conditions only — no people, incidents or private cameras. */
export async function GET() {
  return handle(async () => buildPublicHazards(await getCtx()));
}
