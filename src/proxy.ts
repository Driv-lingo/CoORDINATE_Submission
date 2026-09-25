import { NextResponse, type NextRequest } from "next/server";

/**
 * Chooses the workspace by route:
 *   /demo (and the API calls its pages make) → this browser's private sandbox, running the
 *     simulated exercise, so people exploring the demo never collide;
 *   every other page → the one shared live operation (real feeds, real requests).
 * API calls say which page they come from with the x-coordinate-view header (set by the
 * client fetch helper), falling back to the Referer.
 */
export const WORKSPACE_COOKIE = "cws";
export const WORKSPACE_HEADER = "x-coordinate-workspace";
export const SANDBOX_HEADER = "x-coordinate-sandbox";
export const VIEW_HEADER = "x-coordinate-view";
const LIVE_WS = "live";

export function viewFor(pathname: string, viewHeader: string | null, referer: string | null): "demo" | "live" {
  if (pathname === "/demo" || pathname.startsWith("/demo/") || pathname.startsWith("/api/demo/")) return "demo";
  if (!pathname.startsWith("/api/")) return "live";
  if (viewHeader === "demo" || viewHeader === "live") return viewHeader;
  try {
    const from = referer ? new URL(referer).pathname : "";
    return from === "/demo" || from.startsWith("/demo/") ? "demo" : "live";
  } catch {
    return "live";
  }
}

/**
 * Private preview: when COORDINATE_ACCESS_PASSWORD is set, every page and API
 * asks for that password (HTTP Basic; any user name). /api/health stays open
 * for the App Service health check. Not a substitute for Entra ID sign-in.
 */
const NO_WORKSPACE = /^\/(?:api\/maps\/tiles|api\/health)|\.(?:png|svg|jpg|ico|webmanifest)$/;

export function accessAllowed(authorization: string | null, password: string): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(authorization.slice(6).trim());
  } catch {
    return false;
  }
  const given = decoded.slice(decoded.indexOf(":") + 1);
  if (given.length !== password.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ password.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.COORDINATE_ACCESS_PASSWORD?.trim();
  if (password && !request.nextUrl.pathname.startsWith("/api/health") && !accessAllowed(request.headers.get("authorization"), password)) {
    return new NextResponse("CoORDINATE is in private preview. Ask the team for the access password.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="CoORDINATE private preview", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  // Tiles, health checks and static images don't need a workspace.
  if (NO_WORKSPACE.test(request.nextUrl.pathname)) return NextResponse.next();
  // Never trust client-supplied workspace headers.
  const headers = new Headers(request.headers);
  headers.delete(WORKSPACE_HEADER);
  headers.delete(SANDBOX_HEADER);
  const existing = request.cookies.get(WORKSPACE_COOKIE)?.value;
  const fresh = !(existing && /^sbx-[a-f0-9]{16}$/.test(existing));
  const sandbox = fresh ? `sbx-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}` : existing!;
  const view = viewFor(request.nextUrl.pathname, request.headers.get(VIEW_HEADER), request.headers.get("referer"));
  headers.set(SANDBOX_HEADER, sandbox);
  headers.set(WORKSPACE_HEADER, view === "demo" ? sandbox : LIVE_WS);
  headers.set(VIEW_HEADER, view);
  const response = NextResponse.next({ request: { headers } });
  if (fresh) response.cookies.set(WORKSPACE_COOKIE, sandbox, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
