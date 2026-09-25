import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCameraFrame } from "@/ai";

const ENV = {
  AZURE_AI_FOUNDRY_ENDPOINT: "https://example-res.openai.azure.com",
  AZURE_AI_FOUNDRY_API_KEY: "test-key",
  AZURE_AI_FOUNDRY_DEPLOYMENT: "vision-model",
  AZURE_AI_FOUNDRY_VISION: "true",
};

function reply(content: string) {
  return vi.fn(async () => new Response(JSON.stringify({ model: "vision-model", choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("Azure AI Foundry camera-frame classification", () => {
  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    vi.unstubAllGlobals();
  });

  it("sends the frame with a road-only, no-people prompt and clamps the answer", async () => {
    const fetchMock = reply('{"observationType":"road_blocked","confidence":1.7,"description":"Tree across both lanes near the signal"}');
    vi.stubGlobal("fetch", fetchMock);
    const r = await analyzeCameraFrame("https://cams.example.org/419.jpg");
    expect(r).toMatchObject({ observationType: "ROAD_BLOCKED", confidence: 1, model: "vision-model" });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(JSON.stringify(body.messages[1].content)).toContain("https://cams.example.org/419.jpg");
    expect(body.messages[0].content).toMatch(/Never describe, count, identify or follow people/);
  });

  it("turns anything outside the vocabulary into UNKNOWN", async () => {
    vi.stubGlobal("fetch", reply('{"observationType":"PERSON_DETECTED","confidence":0.9}'));
    expect((await analyzeCameraFrame("https://cams.example.org/1.jpg"))?.observationType).toBe("UNKNOWN");
  });

  it("refuses non-HTTPS frames and returns null when vision is off or the call fails", async () => {
    const fetchMock = reply("{}");
    vi.stubGlobal("fetch", fetchMock);
    expect(await analyzeCameraFrame("http://cams.example.org/1.jpg")).toBeNull();
    process.env.AZURE_AI_FOUNDRY_VISION = "false";
    expect(await analyzeCameraFrame("https://cams.example.org/1.jpg")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.AZURE_AI_FOUNDRY_VISION = "true";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect(await analyzeCameraFrame("https://cams.example.org/1.jpg")).toBeNull();
  });
});

describe("AI wording policy", () => {
  it("rejects drafts that call a route safe or claim agencies were contacted", async () => {
    const { violatesWordingPolicy } = await import("@/ai");
    expect(violatesWordingPolicy("The route is safe now; proceed.")).toBe(true);
    expect(violatesWordingPolicy("911 has been contacted and fire crews are on the way.")).toBe(true);
    expect(violatesWordingPolicy("We notified the utility about the line.")).toBe(true);
    expect(violatesWordingPolicy("Take the route that avoids currently known closures. Call 911 if anyone is hurt.")).toBe(false);
  });
});
