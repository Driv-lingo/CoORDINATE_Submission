import { geocode } from "@/maps/geocode";
import { HttpError } from "@/server/context";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2 || q.length > 200) throw new HttpError(400, "Query must be 2–200 characters");
    return geocode(q);
  });
}
