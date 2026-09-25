import { cookies } from "next/headers";
import { z } from "zod";
import { browserSandbox, getCtx, HttpError, isLive, personaCookieFor } from "@/server/context";
import { handle, readJson } from "@/server/http";
import { coordinatorPasscodeConfigured, coordinatorPasscodeOk, signPersona } from "@/server/session";

export const dynamic = "force-dynamic";

const schema = z.object({ persona: z.string().regex(/^(coordinator|resident|r-[a-z0-9-]+)$/), passcode: z.string().max(200).optional() });

/**
 * Simulated sign-in (production: Microsoft Entra ID).
 * /demo sandbox: switch freely between the fictional personas.
 * Live operation: resident (default), coordinator (passcode when configured), or the volunteer
 * profile this browser registered.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Unknown persona");
    // Validate before setting the cookie, so a failed switch never leaves a bad value behind.
    const ctx = await getCtx();
    const live = isLive(ctx.ws);
    const { persona, passcode } = parsed.data;
    if (live && persona === "coordinator" && coordinatorPasscodeConfigured() && !coordinatorPasscodeOk(passcode)) {
      throw new HttpError(401, passcode ? "Incorrect coordinator passcode." : "Coordinator passcode required.", { passcodeRequired: true });
    }
    if (persona.startsWith("r-")) {
      const r = await ctx.repo.getResponder(ctx.ws, persona);
      if (!r || r.kind !== "PERSON") throw new HttpError(404, "Volunteer not found");
      if (live && r.ownerKey !== (await browserSandbox())) throw new HttpError(403, "You can only sign in as the volunteer profile you registered in this browser.");
    }
    const c = await cookies();
    c.set(personaCookieFor(ctx.ws), signPersona(persona, live), { path: "/", sameSite: "lax", httpOnly: live, secure: live && process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
    return { persona: (await getCtx()).persona };
  });
}
