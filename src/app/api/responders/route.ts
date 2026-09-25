import { computeCommitments } from "@/engine/matching";
import { cookies } from "next/headers";
import { registerVolunteer } from "@/server/actions";
import { browserSandbox, getCtx, isLive, personaCookieFor } from "@/server/context";
import { signPersona } from "@/server/session";
import { handle, readJson } from "@/server/http";
import { lite, publicResponder } from "@/server/views";

export const dynamic = "force-dynamic";

/** Community capacity: every responder, readiness, current deployments and committed equipment. */
export async function GET() {
  return handle(async () => {
    const ctx = await getCtx();
    const [responders, missions] = await Promise.all([ctx.repo.listResponders(ctx.ws), ctx.repo.listMissions(ctx.ws)]);
    const c = computeCommitments(missions, undefined, responders);
    return {
      responders: responders.map(publicResponder),
      lite: responders.map((r) => lite(r, ctx.now)),
      busy: Object.fromEntries(c.personBusy),
      assetCommitted: Object.fromEntries(c.assetCommitted),
    };
  });
}

/** Volunteer self-registration: creates an unverified profile and signs this browser in as it. */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await getCtx();
    const r = await registerVolunteer(ctx, await readJson(req), await browserSandbox());
    (await cookies()).set(personaCookieFor(ctx.ws), signPersona(r.id, isLive(ctx.ws)), { path: "/", sameSite: "lax", httpOnly: isLive(ctx.ws), secure: isLive(ctx.ws) && process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
    return { responder: publicResponder(r) };
  });
}
