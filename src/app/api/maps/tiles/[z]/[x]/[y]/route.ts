import { config } from "@/config";

export const dynamic = "force-dynamic";

/**
 * Azure Maps raster tile proxy. Keeps the subscription key on the server.
 * Without Azure Maps configured, redirects to OpenStreetMap tiles.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/maps/tiles/[z]/[x]/[y]">) {
  const { z, x, y } = await ctx.params;
  const [zi, xi, yi] = [z, x, y.replace(/\.png$/, "")].map((v) => Number.parseInt(v, 10));
  if (![zi, xi, yi].every(Number.isFinite) || zi < 0 || zi > 19) return new Response("Bad tile", { status: 400 });
  const maps = config().maps;
  if (!maps) return Response.redirect(`https://tile.openstreetmap.org/${zi}/${xi}/${yi}.png`, 302);
  const style = new URL(req.url).searchParams.get("style") === "dark" ? "microsoft.base.darkgrey" : "microsoft.base.road";
  const url = `https://atlas.microsoft.com/map/tile?api-version=2024-04-01&tilesetId=${style}&zoom=${zi}&x=${xi}&y=${yi}&tileSize=256&language=en-US`;
  const res = await fetch(url, { headers: { "subscription-key": maps.key } });
  if (!res.ok) return new Response("Tile unavailable", { status: res.status });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
