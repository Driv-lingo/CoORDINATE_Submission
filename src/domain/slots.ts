import type { AssetType, RequirementSlot } from "./types";

/**
 * Equipment a mission can never go without: safety equipment, accessibility equipment, and
 * the supplies that are the point of the mission.
 */
export const ESSENTIAL_ASSETS: ReadonlySet<AssetType> = new Set<AssetType>([
  "HAND_TOOLS", // PPE: respirators, gloves
  "ACCESSIBLE_VAN",
  "REFRIGERATION", // medication
  "PORTABLE_BATTERY", // medical-device power
  "GENERATOR",
  "FOOD_SUPPLY",
  "WATER_SUPPLY",
  "SHELTER_BEDS",
]);

/**
 * Whether a coordinator may dispatch without this slot, after explicitly acknowledging it.
 * Other equipment qualifies (truck, chainsaw, pump, wet/dry vacuum, ladder, tarps, vehicle),
 * e.g. when the resident or the volunteer has their own. So does a person slot the template
 * marks optional (a second lifter). Credentialed leads, two-person safety rules and
 * accessibility roles never qualify.
 *
 * This is computed from what the slot is, not only from a stored flag, so incidents created
 * before a rule change follow the current rule.
 */
export function slotIsOptional(s: Pick<RequirementSlot, "kind" | "asset" | "accessibleRequired" | "optional">): boolean {
  if (s.optional) return true;
  return s.kind === "ASSET" && !!s.asset && !ESSENTIAL_ASSETS.has(s.asset) && !s.accessibleRequired;
}
