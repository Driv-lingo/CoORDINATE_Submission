import { describe, expect, it } from "vitest";
import { assertedHazards, negatedHazardsNeedingReview, scanHazards, scanNeeds, scanVulnerabilities } from "@/engine/textScan";

describe("hazard scanner", () => {
  it.each([
    ["The wires are down and sparking in the yard", "DOWNED_POWER_LINE"],
    ["We smell gas near the meter", "GAS_LEAK"],
    ["The shed is on fire", "ACTIVE_FIRE"],
    ["Someone is threatening people with a gun", "VIOLENCE"],
    ["The garage wall is leaning and could collapse", "UNSTABLE_STRUCTURE"],
    ["Metal drums floating in the creek and a fuel smell", "HAZARDOUS_MATERIALS"],
    ["A car stalled in flood water with the driver inside", "SWIFT_WATER"],
    ["My dad fell and hit his head, now he is confused", "MEDICAL_EMERGENCY"],
  ])("detects %s", (text, hazard) => {
    expect(assertedHazards(scanHazards(text))).toContain(hazard);
  });

  it("treats “Nobody is injured” as a negation, not a medical emergency", () => {
    expect(assertedHazards(scanHazards("A tree fell. Nobody is injured but we are stuck."))).not.toContain("MEDICAL_EMERGENCY");
  });

  it("flags negated strong hazards for human review instead of silently ignoring them", () => {
    const mentions = scanHazards("Trees are down. No power lines are down as far as we can see.");
    expect(assertedHazards(mentions)).not.toContain("DOWNED_POWER_LINE");
    expect(negatedHazardsNeedingReview(mentions).map((m) => m.hazard)).toEqual(["DOWNED_POWER_LINE"]);
  });

  it("is conservative: an asserted mention wins over a negated one", () => {
    const mentions = scanHazards("No sparks now, but the power line is lying on the car.");
    expect(assertedHazards(mentions)).toContain("DOWNED_POWER_LINE");
  });

  it("does not confuse 'fire department' or 'heart attack' with fire or violence", () => {
    const hz = assertedHazards(scanHazards("We called the fire department about his heart attack"));
    expect(hz).not.toContain("ACTIVE_FIRE");
    expect(hz).not.toContain("VIOLENCE");
    expect(hz).toContain("MEDICAL_EMERGENCY");
  });

  it("does not read a limb on the roof as people stranded on a roof", () => {
    expect(assertedHazards(scanHazards("A limb fell on our roof and rain is coming in"))).not.toContain("SWIFT_WATER");
  });
});

describe("needs and vulnerability scanners", () => {
  it("extracts tree cutting and blocked access", () => {
    expect(scanNeeds("A tree fell across my driveway and we cannot leave")).toEqual(expect.arrayContaining(["TREE_CUTTING", "ACCESS_BLOCKED"]));
  });
  it("treats a limb through the roof as roof protection, not tree felling", () => {
    const needs = scanNeeds("A large limb punched a hole in our roof and rain is coming in");
    expect(needs).toContain("ROOF_TARP");
    expect(needs).not.toContain("TREE_CUTTING");
  });
  it("detects older adults, mobility and medical dependency", () => {
    expect(scanVulnerabilities("My aunt is 84, uses a wheelchair and is on oxygen")).toEqual(
      expect.arrayContaining(["OLDER_ADULT", "MOBILITY_LIMITED", "MEDICAL_DEPENDENCY"]),
    );
  });
});
