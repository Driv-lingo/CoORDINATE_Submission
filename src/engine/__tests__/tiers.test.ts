import { describe, expect, it } from "vitest";
import { communityReportFromIncident } from "@/data/scenarioOps";
import { LifecycleError, recordHandoffAcknowledgement, recordHandoffContact, setNeeds } from "@/engine/lifecycle";
import { intake, NOW } from "./helpers";

const REPORT = "FYI — a large tree is down across both lanes of Grandin Rd near Brandon Ave. Just reporting it, no help needed.";

describe("response classes", () => {
  it("logs a road-condition report as INFORMATION_ONLY with no mission (R-I01)", () => {
    const inc = intake(REPORT);
    expect(inc.triage.level).toBe("INFORMATION_ONLY");
    expect(inc.status).toBe("LOGGED");
    expect(inc.assessment.category).toBe("ROAD_CONDITION_REPORT");
    expect(inc.assessment.needs).toEqual([]);
    expect(inc.requirements).toEqual([]);
    expect(inc.handoffs).toEqual([]);
    expect(inc.priority.level).toBe("P4");
    expect(inc.triage.rulesFired.map((r) => r.ruleId)).toContain("R-I01");
  });

  it("never treats a personal need as information-only", () => {
    const inc = intake("Heads up, a tree is down across our driveway on Keagy Rd and we can't get out.");
    expect(inc.triage.level).not.toBe("INFORMATION_ONLY");
    expect(inc.assessment.needs).toContain("TREE_CUTTING");
  });

  it("does not let the AI make a request information-only (no de-escalation)", () => {
    const ai = { category: "ROAD_CONDITION_REPORT", needs: [], hazards: [], summary: "Road report" };
    const inc = intake("A tree fell on my driveway and I need help clearing it before tonight.", { raw: ai });
    expect(inc.triage.level).not.toBe("INFORMATION_ONLY");
    expect(inc.assessment.category).not.toBe("ROAD_CONDITION_REPORT");
    expect(inc.requirements.length).toBeGreaterThan(0);
  });

  it("a hazard in a 'just reporting' message still escalates", () => {
    const inc = intake("Just letting you know power lines are down across Colonial Ave, both lanes blocked. No help needed.");
    expect(inc.triage.level).toBe("PROFESSIONAL_RESPONSE_REQUIRED");
    expect(inc.status).toBe("ESCALATED");
  });

  it("a coordinator can convert an information-only report into a request", () => {
    const inc = intake(REPORT);
    const converted = setNeeds(inc, ["TREE_CUTTING", "ACCESS_BLOCKED"], "Ellis Morgan", NOW);
    expect(converted.status).toBe("OPEN");
    expect(converted.assessment.informationOnly).toBe(false);
    expect(converted.assessment.category).toBe("DEBRIS_CLEARANCE");
    expect(converted.triage.level).toBe("TRAINED_VOLUNTEER_ELIGIBLE");
    expect(converted.requirements.some((s) => s.credentials.includes("CHAINSAW_SAFETY"))).toBe(true);
  });

  it("requires a licensed trade for generator hookups (SPECIALIZED, R-T02)", () => {
    const inc = intake("The community center lost power. A donated generator arrived and we need a licensed electrician to connect it to the building's transfer switch.");
    expect(inc.assessment.needs).toContain("GENERATOR_POWER");
    expect(inc.triage.level).toBe("SPECIALIZED_VOLUNTEER_ELIGIBLE");
    expect(inc.triage.civilianDispatchAllowed).toBe(true);
    expect(inc.triage.rulesFired.map((r) => r.ruleId)).toContain("R-T02");
    expect(inc.requirements.find((s) => s.id === "electrician")?.credentials).toContain("LICENSED_ELECTRICIAN");
  });

  it("an information-only report becomes an UNVERIFIED community event, never actionable alone", () => {
    const inc = intake(REPORT);
    const ev = communityReportFromIncident(inc, "SCENARIO");
    expect(ev.authorityLevel).toBe("COMMUNITY_REPORT");
    expect(ev.verificationStatus).toBe("UNVERIFIED");
    expect(ev.incidentId).toBe(inc.id);
    expect(ev.effects[0].kind).toBe("BLOCKS_ROAD");
    expect(ev.roadName).toBe("Grandin Rd");
  });
});

describe("professional escalation records", () => {
  const escalated = () => intake("A tree came down on the power lines in front of our house and the wires are sparking.");

  it("starts as a recommendation and only a coordinator's record changes it", () => {
    const inc = escalated();
    expect(inc.handoffs.every((h) => h.status === "RECOMMENDED")).toBe(true);
    const contacted = recordHandoffContact(inc, "ELECTRIC_UTILITY", "Ellis Morgan", "Called the hazard line", NOW);
    const h = contacted.handoffs.find((x) => x.target === "ELECTRIC_UTILITY")!;
    expect(h.status).toBe("CONTACT_RECORDED");
    expect(h.contactedBy).toBe("Ellis Morgan");
    expect(contacted.timeline.at(-1)!.message).toMatch(/recorded contacting .* \(outside CoORDINATE\)/);
    const acked = recordHandoffAcknowledgement(contacted, "ELECTRIC_UTILITY", "Ellis Morgan", "APCO-4471", NOW);
    expect(acked.handoffs.find((x) => x.target === "ELECTRIC_UTILITY")!.reference).toBe("APCO-4471");
  });

  it("cannot record an acknowledgement before the contact", () => {
    expect(() => recordHandoffAcknowledgement(escalated(), "FIRE_RESCUE_911", "Ellis Morgan", "", NOW)).toThrow(LifecycleError);
  });
});

describe("possible duplicates (R-A04)", () => {
  it("flags — never merges — a second report of the same need at the same place", async () => {
    const { findPossibleDuplicates, duplicateAdvisory } = await import("@/engine/dedupe");
    const first = { ...intake("A tree fell across my driveway and we can't get out."), id: "inc-a", number: "INC-1" };
    const second = { ...intake("Tree down blocking our driveway, we cannot leave."), id: "inc-b", number: "INC-2" };
    const far = { ...second, id: "inc-c", location: { lat: second.location.lat + 0.01, lng: second.location.lng } };
    const other = { ...intake("We need drinking water for the family."), id: "inc-d" };
    expect(findPossibleDuplicates(second, [first, far, other]).map((i) => i.id)).toEqual(["inc-a"]);
    const adv = duplicateAdvisory(findPossibleDuplicates(second, [first]))!;
    expect(adv).toMatchObject({ ruleId: "R-A04", requiresAcknowledgement: true });
    expect(adv.message).toContain("INC-1");
    expect(duplicateAdvisory([])).toBeNull();
  });
});

describe("R-I01 never swallows a personal need (review L4)", () => {
  it("'my driveway … my car is stuck' is a request, not a road report", () => {
    const inc = intake("FYI tree down blocking my driveway on Oak St, my car is stuck. Just reporting.");
    expect(inc.triage.level).not.toBe("INFORMATION_ONLY");
    expect(inc.status).not.toBe("LOGGED");
  });
});
