import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { config } from "@/config";

/**
 * Azure Web PubSub fan-out. After any state change the server publishes a tiny
 * "changed" event to the workspace's group; connected browsers refetch. Without
 * Web PubSub configured, clients fall back to 5-second polling.
 */
const g = globalThis as unknown as { __coordinatePubSub?: WebPubSubServiceClient | null };

function client(): WebPubSubServiceClient | null {
  if (g.__coordinatePubSub !== undefined) return g.__coordinatePubSub;
  const c = config().webPubSub;
  g.__coordinatePubSub = c ? new WebPubSubServiceClient(c.connectionString, c.hub) : null;
  return g.__coordinatePubSub;
}

/** Group names must be URL-safe; workspace ids already are. */
const groupFor = (ws: string) => `ws-${ws}`;

export async function publishChange(ws: string, kind: string): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    await c.group(groupFor(ws)).sendToAll({ type: "changed", kind, at: new Date().toISOString() }, { messageTtlSeconds: 60 });
  } catch (err) {
    console.warn("[coordinate] Web PubSub publish failed; clients will catch up by polling", (err as Error).message);
  }
}

export async function negotiate(ws: string): Promise<{ url: string } | null> {
  const c = client();
  if (!c) return null;
  const token = await c.getClientAccessToken({ groups: [groupFor(ws)], expirationTimeInMinutes: 60 });
  return { url: token.url };
}
