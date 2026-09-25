import type { NextRequest } from "next/server";
import { LIVE_WS } from "@/data/mode";
import { negotiate } from "@/realtime/pubsub";
import { getCtx, HttpError } from "@/server/context";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Returns a short-lived Azure Web PubSub client URL scoped to one group (receive only):
 * this browser's workspace, or with ?view=live the read-only /live feed group.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const ws = request.nextUrl.searchParams.get("view") === "live" ? LIVE_WS : (await getCtx()).ws;
    const res = await negotiate(ws);
    if (!res) throw new HttpError(404, "Realtime is not configured; use polling.");
    return res;
  });
}
