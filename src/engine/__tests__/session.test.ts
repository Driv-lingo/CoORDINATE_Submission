import { afterEach, describe, expect, it } from "vitest";
import { coordinatorPasscodeOk, signPersona, verifyPersona } from "@/server/session";

describe("live-operation sign-in hardening (M9)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("trusts plain persona cookies only in /demo sandboxes", () => {
    expect(verifyPersona("coordinator")).toBe("coordinator");
    expect(verifyPersona("coordinator", true)).toBeNull();
  });

  it("in the live operation, requires a valid signature, and a passcode when configured", () => {
    process.env.COORDINATE_SESSION_SECRET = "test-secret-please-change";
    process.env.COORDINATE_COORDINATOR_PASSCODE = "eoc-2026";
    expect(verifyPersona("coordinator.forged", true)).toBeNull();
    expect(verifyPersona(signPersona("coordinator", true), true)).toBe("coordinator");
    expect(verifyPersona(signPersona("r-jordan", true), true)).toBe("r-jordan");
    expect(coordinatorPasscodeOk("eoc-2026")).toBe(true);
    expect(coordinatorPasscodeOk("guess")).toBe(false);
    expect(coordinatorPasscodeOk(undefined)).toBe(false);
  });

  it("still signs live cookies without a configured secret (per-process key), and never accepts a demo cookie there", () => {
    delete process.env.COORDINATE_SESSION_SECRET;
    const live = signPersona("coordinator", true);
    expect(verifyPersona(live, true)).toBe("coordinator");
    // A demo cookie (unsigned without a secret) never grants anything in the live operation.
    expect(verifyPersona(signPersona("coordinator"), true)).toBeNull();
  });
});

describe("workspace by route", () => {
  it("sends /demo pages and their API calls to the sandbox, everything else to the live operation", async () => {
    const { viewFor } = await import("@/proxy");
    expect(viewFor("/demo", null, null)).toBe("demo");
    expect(viewFor("/demo/ops/incidents/inc-1", null, null)).toBe("demo");
    expect(viewFor("/api/demo/reset", null, null)).toBe("demo");
    expect(viewFor("/ops", "demo", null)).toBe("live"); // a page's own path always wins
    expect(viewFor("/map", null, "https://x/demo")).toBe("live");
    expect(viewFor("/api/incidents", "demo", null)).toBe("demo");
    expect(viewFor("/api/incidents", null, "https://x/demo/ops")).toBe("demo");
    expect(viewFor("/api/incidents", null, "https://x/ops")).toBe("live");
    expect(viewFor("/api/incidents", "bogus", "https://x/demonstration")).toBe("live");
    expect(viewFor("/api/incidents", null, null)).toBe("live");
  });
});

describe("private-preview access gate", () => {
  it("accepts only the configured password, with any user name", async () => {
    const { accessAllowed } = await import("@/proxy");
    const basic = (s: string) => `Basic ${btoa(s)}`;
    expect(accessAllowed(basic("judge:open-sesame"), "open-sesame")).toBe(true);
    expect(accessAllowed(basic(":open-sesame"), "open-sesame")).toBe(true);
    expect(accessAllowed(basic("judge:wrong"), "open-sesame")).toBe(false);
    expect(accessAllowed(null, "open-sesame")).toBe(false);
    expect(accessAllowed("Basic !!!", "open-sesame")).toBe(false);
  });
});

describe("demo sandboxes with a session secret (Azure default)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("accepts the signed persona cookie the persona switch writes, and still accepts unsigned ones", () => {
    process.env.COORDINATE_SESSION_SECRET = "azure-generated-secret";
    expect(verifyPersona(signPersona("coordinator"))).toBe("coordinator");
    expect(verifyPersona(signPersona("r-jordan"))).toBe("r-jordan");
    expect(verifyPersona("coordinator")).toBe("coordinator");
    expect(verifyPersona("coordinator.forged")).toBeNull();
  });
});
