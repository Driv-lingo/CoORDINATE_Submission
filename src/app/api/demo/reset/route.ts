import { cookies } from "next/headers";
import { publishChange } from "@/realtime/pubsub";
import { getCtx, HttpError, PERSONA_COOKIE, SANDBOX_ID } from "@/server/context";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

/** Restore this browser's sandbox to the seeded scenario. */
export async function POST() {
  return handle(async () => {
    const ctx = await getCtx();
    // Only this browser's demo sandbox can be reset — never the live operation.
    if (!SANDBOX_ID.test(ctx.ws)) throw new HttpError(409, "Only the demo sandbox can be reset.");
    await ctx.repo.resetWorkspace(ctx.ws);
    void publishChange(ctx.ws, "workspace.reset");
    (await cookies()).set(PERSONA_COOKIE, "coordinator", { path: "/", sameSite: "lax" });
    return { ok: true, workspace: ctx.ws };
  });
}
