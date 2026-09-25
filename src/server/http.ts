import { NextResponse } from "next/server";
import { LifecycleError } from "@/engine/lifecycle";
import { HttpError } from "./context";

/** Uniform JSON error handling for route handlers. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HttpError || err instanceof LifecycleError) {
      const status = err instanceof HttpError ? err.status : err.status;
      return NextResponse.json({ error: err.message, details: err.details }, { status });
    }
    console.error("[coordinate] unhandled API error", err);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}
