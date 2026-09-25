import { submitIntake } from "@/server/actions";
import { getCtx } from "@/server/context";
import { handle, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** Intake: AI interpretation → deterministic validation → triage → requirements. */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await getCtx();
    const incident = await submitIntake(ctx, await readJson(req));
    return { incident };
  });
}
