import { CATEGORY_LABELS } from "@/domain/catalog";
import type { Assessment } from "@/domain/types";

/** Deterministic, human-friendly mission titles, e.g. “Blocked Accessible Residence”. */
export function missionTitle(a: Assessment): string {
  const n = new Set(a.needs);
  const v = new Set(a.vulnerabilities);
  const accessible = v.has("MOBILITY_LIMITED");
  if (n.has("TREE_CUTTING") && n.has("ACCESS_BLOCKED")) return accessible ? "Blocked Accessible Residence" : "Blocked Residence — Tree Clearance";
  if (n.has("TREE_CUTTING") || n.has("DEBRIS_REMOVAL")) return "Tree & Debris Clearance";
  if (n.has("POWER_MEDICAL_DEVICE")) return "Medical Device Power Support";
  if (n.has("GENERATOR_POWER")) return "Facility Generator Hookup";
  if (n.has("SHELTER_STAFFING")) return "Shelter Staffing";
  if (n.has("REFRIGERATION")) return "Medication Refrigeration";
  if (n.has("ROOF_TARP")) return "Emergency Roof Tarp";
  if (n.has("MUCK_OUT")) return "Flood Muck-Out";
  if (n.has("MOVE_BELONGINGS")) return v.has("LANGUAGE_ACCESS") ? "Belongings Relocation — Language Support" : "Belongings Relocation";
  if (n.has("WATER_MITIGATION")) return "Flood Water Removal";
  if (n.has("TRANSPORTATION")) return accessible ? "Accessible Transport" : "Community Transport";
  if (n.has("SHELTER")) return "Emergency Shelter Placement";
  if (n.has("WELLNESS_CHECK")) return v.has("ISOLATED") ? "Wellness Check — Isolated Resident" : "Wellness Check";
  if (n.has("FOOD") || n.has("WATER")) return v.has("CHILDREN") ? "Family Supply Delivery" : "Supply Delivery";
  if (n.has("MEDICATION")) return "Medication Courier";
  if (n.has("DEVICE_CHARGING")) return "Community Charging Point";
  return CATEGORY_LABELS[a.category];
}
