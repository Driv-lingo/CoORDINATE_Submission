import { getCtx } from "@/server/context";
import { handle } from "@/server/http";
import { providerStatus } from "@/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const ctx = await getCtx();
    return { ...providerStatus(ctx.ws), persona: ctx.persona };
  });
}
