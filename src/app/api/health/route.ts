import { aiProvider } from "@/ai";
import { config } from "@/config";

export const dynamic = "force-dynamic";

/** Liveness probe for Azure App Service health checks. Does not touch the data store. */
export async function GET() {
  const c = config();
  return Response.json(
    {
      ok: true,
      ai: aiProvider().provider,
      data: c.cosmos ? "cosmos" : "memory",
      maps: c.maps ? "azure-maps" : "openstreetmap",
      realtime: c.webPubSub ? "azure-web-pubsub" : "polling",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
