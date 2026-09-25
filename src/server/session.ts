import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sign-in hardening for the prototype (production: Microsoft Entra ID).
 *
 * The live operation (every page except /demo) is shared by everyone, so its persona cookie
 * must carry a valid HMAC signature, and becoming a coordinator needs the passcode when one is
 * configured. /demo sandboxes belong to one browser and keep the one-click persona switcher.
 */

const g = globalThis as unknown as { __coordinateEphemeralSecret?: string };

function envSecret(): string | undefined {
  return process.env.COORDINATE_SESSION_SECRET?.trim() || undefined;
}

/** The live operation always signs: without a configured secret, a per-process one (sign-ins reset on restart). */
function liveSecret(): string {
  return envSecret() ?? (g.__coordinateEphemeralSecret ??= randomBytes(32).toString("hex"));
}

function sign(value: string, s: string) {
  return `${value}.${createHmac("sha256", s).update(value).digest("base64url")}`;
}

function checkSigned(cookie: string, s: string | undefined): string | null {
  const i = cookie.lastIndexOf(".");
  if (i <= 0 || !s) return null;
  const value = cookie.slice(0, i);
  const sig = Buffer.from(cookie.slice(i + 1));
  const expected = Buffer.from(createHmac("sha256", s).update(value).digest("base64url"));
  return sig.length === expected.length && timingSafeEqual(sig, expected) ? value : null;
}

export function signPersona(value: string, live = false): string {
  if (live) return sign(value, liveSecret());
  const s = envSecret();
  return s ? sign(value, s) : value;
}

/**
 * The persona value if the cookie is trustworthy, otherwise null.
 * Live: only a valid signature. Demo sandbox: a valid signature, or an unsigned value.
 */
export function verifyPersona(cookie: string | undefined, live = false): string | null {
  if (!cookie) return null;
  if (live) return checkSigned(cookie, liveSecret());
  if (cookie.lastIndexOf(".") > 0) return checkSigned(cookie, envSecret());
  return cookie;
}

/** Whether a coordinator passcode protects the live operation. */
export function coordinatorPasscodeConfigured(): boolean {
  return !!process.env.COORDINATE_COORDINATOR_PASSCODE?.trim();
}

export function coordinatorPasscodeOk(passcode: string | undefined): boolean {
  const expected = process.env.COORDINATE_COORDINATOR_PASSCODE?.trim();
  if (!expected || !passcode) return false;
  const a = Buffer.from(passcode);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
