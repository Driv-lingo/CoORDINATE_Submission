import { responderAction } from "@/server/actions";
import { getCtx, HttpError } from "@/server/context";
import { maybeReassess } from "@/server/ops";
import { handle, readJson } from "@/server/http";
import { buildVolunteerView } from "@/server/views";

export const dynamic = "force-dynamic";

/** Volunteer view: readiness, eligible missions only, active and completed missions. */
export async function GET(_req: Request, ctx: RouteContext<"/api/responders/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await getCtx();
    // A volunteer's phone must reflect new holds even when no dashboard is open.
    await maybeReassess(c);
    const view = await buildVolunteerView(c, id);
    if (!view) throw new HttpError(404, "Responder not found");
    return view;
  });
}

/** Responder actions: availability | complete-training | submit-credential | verify-credential */
export async function POST(req: Request, ctx: RouteContext<"/api/responders/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await getCtx();
    await responderAction(c, id, await readJson(req));
    return buildVolunteerView(c, id);
  });
}
