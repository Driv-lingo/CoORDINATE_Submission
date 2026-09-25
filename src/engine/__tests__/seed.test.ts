import { describe, expect, it } from "vitest";
import { buildChatUrl, parseJsonObject } from "@/ai/foundry";
import { world } from "./helpers";

describe("seeded Virginia scenario", () => {
  it("meets the demo-data brief", () => {
    const w = world();
    expect(w.incidents.length).toBeGreaterThanOrEqual(12);
    expect(w.incidents.length).toBeLessThanOrEqual(20);
    expect(w.responders.filter((r) => r.kind === "PERSON").length).toBeGreaterThanOrEqual(15);
    const orgs = w.responders.filter((r) => r.kind === "ORGANIZATION").length;
    expect(orgs).toBeGreaterThanOrEqual(3);
    expect(orgs).toBeLessThanOrEqual(5);
    expect(w.incidents.filter((i) => i.status === "ESCALATED").length).toBeGreaterThanOrEqual(4);
    expect(new Set(w.incidents.map((i) => i.status))).toEqual(new Set(["GUIDED", "OPEN", "TEAM_FORMING", "ACTIVE", "RESOLVED", "ESCALATED", "LOGGED"]));
  });

  it("keeps the guided-demo team free and makes the first live mission MSN-021", () => {
    const w = world();
    expect(Math.max(...w.missions.map((m) => m.number))).toBe(20);
    const active = w.missions.filter((m) => m.status === "DISPATCHED" || m.status === "IN_PROGRESS");
    const busy = new Set(active.flatMap((m) => m.assignments.map((a) => a.responderId)));
    for (const id of ["r-jordan", "r-priya", "o-blueridge"]) expect(busy.has(id)).toBe(false);
  });

  it("is deterministic for a given clock", () => {
    expect(JSON.stringify(world())).toBe(JSON.stringify(world()));
  });
});

describe("Azure AI Foundry adapter", () => {
  it("builds v1 and deployment-style URLs", () => {
    expect(buildChatUrl({ endpoint: "https://res.openai.azure.com/", deployment: "gpt-4o-mini" })).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
    expect(buildChatUrl({ endpoint: "https://res.services.ai.azure.com/api/projects/p1", deployment: "m" })).toBe("https://res.services.ai.azure.com/openai/v1/chat/completions");
    expect(buildChatUrl({ endpoint: "https://res.openai.azure.com", deployment: "gpt 4o", apiVersion: "2024-10-21" })).toBe(
      "https://res.openai.azure.com/openai/deployments/gpt%204o/chat/completions?api-version=2024-10-21",
    );
  });
  it("extracts JSON from fenced completions", () => {
    expect(parseJsonObject('```json\n{"category":"SHELTER"}\n```')).toEqual({ category: "SHELTER" });
  });
});
