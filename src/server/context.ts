import { cookies, headers } from "next/headers";
import { getRepository, type Repository } from "@/data";
import { LIVE_WS } from "@/data/mode";
import { SCENARIO } from "@/data/seed";
import { verifyPersona } from "./session";

/** Persona cookies: one per mode, so a demo sign-in never carries into the live operation. */
export const PERSONA_COOKIE = "cpersona";
export const LIVE_PERSONA_COOKIE = "cpersona_live";
const WORKSPACE_COOKIE = "cws";
const WORKSPACE_HEADER = "x-coordinate-workspace";
const SANDBOX_HEADER = "x-coordinate-sandbox";
export const SANDBOX_ID = /^sbx-(?:[a-f0-9]{16}|default)$/;

export type Persona =
  | { kind: "coordinator"; id: string; name: string }
  | { kind: "resident"; id: string; name: string }
  | { kind: "responder"; id: string; name: string };

export interface Ctx {
  repo: Repository;
  ws: string;
  persona: Persona;
  now: Date;
}

export const isLive = (ws: string) => ws === LIVE_WS;
export const personaCookieFor = (ws: string) => (isLive(ws) ? LIVE_PERSONA_COOKIE : PERSONA_COOKIE);

/** This browser's sandbox id (also its anonymous identity in the live operation). */
export async function browserSandbox(): Promise<string> {
  const valid = (v: string | null | undefined): v is string => !!v && SANDBOX_ID.test(v);
  const h = await headers();
  const fromHeader = h.get(SANDBOX_HEADER);
  if (valid(fromHeader)) return fromHeader;
  const v = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return valid(v) ? v : "sbx-default";
}

/**
 * The workspace for this request, chosen by route in the proxy: /demo → this browser's
 * sandbox (the simulated exercise); everything else → the shared live operation.
 */
export async function resolveWorkspace(): Promise<string> {
  const h = await headers();
  const ws = h.get(WORKSPACE_HEADER);
  if (ws === LIVE_WS || (ws && SANDBOX_ID.test(ws))) return ws;
  return LIVE_WS;
}

export async function getCtx(): Promise<Ctx> {
  return getCtxFor(await resolveWorkspace());
}

export async function getCtxFor(ws: string, opts: { ensure?: boolean } = {}): Promise<Ctx> {
  const repo = getRepository();
  // Seeding a demo sandbox is only done when the demo is actually used.
  if (opts.ensure !== false) await repo.ensureWorkspace(ws);
  const c = await cookies();
  const live = isLive(ws);
  const cookie = c.get(personaCookieFor(ws))?.value;
  // Demo sandbox: no cookie yet → the demo lands on the coordinator view.
  // Live operation: a valid signed cookie, otherwise (and by default) an anonymous resident.
  // Any unrecognized value fails closed to the least-privileged persona (resident).
  const raw = verifyPersona(cookie, live) ?? (live || cookie ? "resident" : "coordinator");
  const resident: Persona = live
    ? { kind: "resident", id: `res-${(await browserSandbox()).slice(4)}`, name: "Resident" }
    : { kind: "resident", id: SCENARIO.resident.id, name: SCENARIO.resident.name };
  let persona: Persona = resident;
  if (raw === "coordinator") persona = live ? { kind: "coordinator", id: "coordinator", name: "Coordinator" } : { kind: "coordinator", id: SCENARIO.coordinator.id, name: SCENARIO.coordinator.name };
  else if (/^r-[a-z0-9-]{1,40}$/.test(raw)) {
    const r = await repo.getResponder(ws, raw);
    if (r && r.kind === "PERSON") persona = { kind: "responder", id: r.id, name: r.name };
  }
  return { repo, ws, persona, now: new Date() };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function requireCoordinator(ctx: Ctx) {
  if (ctx.persona.kind !== "coordinator") {
    throw new HttpError(403, `Only an authorized coordinator can do this. You are acting as ${ctx.persona.name}.`);
  }
}
