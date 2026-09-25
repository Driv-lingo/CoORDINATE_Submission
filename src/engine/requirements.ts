import type {
  Assessment,
  AssetType,
  CredentialType,
  HazardClearance,
  NeedType,
  RequirementSlot,
  Skill,
  TrainingModuleId,
  TriageResult,
} from "@/domain/types";
import { VULNERABLE_OCCUPANT } from "./rules";
import { triage } from "./triage";

/**
 * Deterministic capability derivation: needs → required people and assets.
 * No AI involvement. Each slot carries the rule/need it came from so the
 * coordinator can see *why* a role exists.
 */


interface SlotTemplate {
  kind: "PERSON" | "ASSET";
  label: string;
  skill?: Skill;
  credentials?: CredentialType[];
  training?: TrainingModuleId[];
  asset?: AssetType;
  quantity?: number | ((a: Assessment) => number);
  accessibleRequired?: boolean;
  rationale: string;
  /** Supporting role/equipment the team can go without if the coordinator acknowledges it. */
  optional?: boolean;
  /** Slots with the same key are merged across needs (e.g. one truck for debris + belongings). */
  key: string;
}

function templatesFor(need: NeedType, a: Assessment): SlotTemplate[] {
  const mobility = a.vulnerabilities.includes("MOBILITY_LIMITED");
  switch (need) {
    default:
      // Navigator needs (referrals, escalations, information) and SHELTER placement never create mission roles.
      return [];
    case "TREE_CUTTING":
      return [
        {
          key: "chainsaw-operator",
          kind: "PERSON",
          label: "Chainsaw operator",
          skill: "CHAINSAW_OPERATION",
          credentials: ["CHAINSAW_SAFETY"],
          rationale: "Cutting storm-damaged trees is a leading cause of volunteer injury; a verified chainsaw safety credential is mandatory.",
        },
        { key: "chainsaw", kind: "ASSET", label: "Chainsaw", asset: "CHAINSAW", rationale: "Equipment for the operator." },
      ];
    case "DEBRIS_REMOVAL":
    case "ACCESS_BLOCKED":
      return [
        { key: "labor-1", kind: "PERSON", label: "General volunteer (debris handling)", skill: "GENERAL_LABOR", rationale: "Move and stack cut debris; spotter for the saw operator." },
        { key: "haul", kind: "ASSET", label: "Pickup truck", asset: "PICKUP_TRUCK", rationale: "Haul debris clear of the access route." },
      ];
    case "WATER_MITIGATION":
      return [
        { key: "flood-1", kind: "PERSON", label: "Flood-cleanup volunteer", skill: "GENERAL_LABOR", training: ["FLOOD_CLEANUP_SAFETY"], rationale: "Floodwater is contaminated; flood-cleanup safety training is required." },
        { key: "pump", kind: "ASSET", label: "Water pump (submersible/utility)", asset: "WATER_PUMP", rationale: "Standing water is pumped out; a vacuum cannot move that volume." },
        { key: "vac", kind: "ASSET", label: "Wet/dry vacuum", asset: "WET_VAC", rationale: "Residual water after pumping." },
      ];
    case "MUCK_OUT":
      return [
        { key: "flood-1", kind: "PERSON", label: "Flood-cleanup volunteer", skill: "GENERAL_LABOR", training: ["FLOOD_CLEANUP_SAFETY"], rationale: "Tear-out exposes mold and contaminated materials." },
        { key: "flood-2", kind: "PERSON", label: "Flood-cleanup volunteer", skill: "GENERAL_LABOR", training: ["FLOOD_CLEANUP_SAFETY"], rationale: "Buddy system for tear-out work." },
        { key: "tools", kind: "ASSET", label: "Hand tools & PPE kit", asset: "HAND_TOOLS", rationale: "Pry bars, shovels, respirators." },
      ];
    case "MOVE_BELONGINGS":
      return [
        { key: "labor-1", kind: "PERSON", label: "General volunteer (lifting)", skill: "GENERAL_LABOR", rationale: "Carry belongings to a dry area." },
        { key: "labor-2", kind: "PERSON", label: "General volunteer (lifting)", skill: "GENERAL_LABOR", rationale: "Two-person lifts for furniture.", optional: true },
      ];
    case "ROOF_TARP":
      return [
        { key: "roof-1", kind: "PERSON", label: "Roof tarping lead", skill: "ROOF_TARPING", credentials: ["ROOF_FALL_PROTECTION"], rationale: "Roof work is a fall hazard; fall-protection credential required." },
        { key: "roof-2", kind: "PERSON", label: "Roof tarping second", skill: "ROOF_TARPING", credentials: ["ROOF_FALL_PROTECTION"], rationale: "Never work a roof alone." },
        { key: "tarps", kind: "ASSET", label: "Tarps", asset: "TARPS", quantity: 2, rationale: "Temporary weatherproofing." },
        { key: "ladder", kind: "ASSET", label: "Extension ladder", asset: "LADDER", rationale: "Roof access." },
      ];
    case "FOOD":
      return [
        { key: "food", kind: "ASSET", label: "Meals", asset: "FOOD_SUPPLY", quantity: (x) => x.peopleAffected * 3, rationale: "Three meals per person." },
        { key: "driver", kind: "PERSON", label: "Delivery driver", skill: "DRIVING", credentials: ["DRIVERS_LICENSE"], rationale: "Deliver to the household." },
      ];
    case "WATER":
      return [
        { key: "water", kind: "ASSET", label: "Drinking water", asset: "WATER_SUPPLY", quantity: (x) => x.peopleAffected * 3, rationale: "One gallon per person per day, three days." },
        { key: "driver", kind: "PERSON", label: "Delivery driver", skill: "DRIVING", credentials: ["DRIVERS_LICENSE"], rationale: "Deliver to the household." },
      ];
    case "MEDICATION":
      return [
        { key: "driver", kind: "PERSON", label: "Medication courier", skill: "DRIVING", credentials: ["DRIVERS_LICENSE", "BACKGROUND_CHECK"], rationale: "Handling a resident's medication requires a background check." },
      ];
    case "POWER_MEDICAL_DEVICE":
      return [
        { key: "battery", kind: "ASSET", label: "Portable battery station", asset: "PORTABLE_BATTERY", rationale: "Battery stations are safe indoors; generators are never run inside (CO risk)." },
        { key: "driver", kind: "PERSON", label: "Power-support courier", skill: "DRIVING", credentials: ["DRIVERS_LICENSE"], training: ["GENERATOR_CO_SAFETY"], rationale: "Deliver and set up power safely." },
      ];
    case "DEVICE_CHARGING":
      return [{ key: "battery", kind: "ASSET", label: "Portable battery station", asset: "PORTABLE_BATTERY", rationale: "Charge phones so residents can call for help." }];
    case "REFRIGERATION":
      return [
        { key: "fridge", kind: "ASSET", label: "Medication refrigeration", asset: "REFRIGERATION", rationale: "Insulin and some medications must stay cold." },
        { key: "driver", kind: "PERSON", label: "Delivery driver", skill: "DRIVING", credentials: ["DRIVERS_LICENSE"], rationale: "Deliver refrigeration unit." },
      ];
    case "TRANSPORTATION":
      return mobility
        ? [
            { key: "driver", kind: "PERSON", label: "Accessible-transport driver", skill: "ACCESSIBLE_TRANSPORT", credentials: ["DRIVERS_LICENSE", "WHEELCHAIR_SECUREMENT"], rationale: "Passenger uses a mobility device; wheelchair securement training required." },
            { key: "vehicle", kind: "ASSET", label: "Wheelchair-accessible van", asset: "ACCESSIBLE_VAN", accessibleRequired: true, rationale: "Standard vehicles cannot carry the passenger safely." },
          ]
        : [
            { key: "driver", kind: "PERSON", label: "Volunteer driver", skill: "DRIVING", credentials: ["DRIVERS_LICENSE"], rationale: "Transport to shelter, medical care or pharmacy." },
            { key: "vehicle", kind: "ASSET", label: "Passenger vehicle", asset: "PASSENGER_VEHICLE", rationale: "Transport vehicle." },
          ];
    case "WELLNESS_CHECK":
      return [
        { key: "visit-1", kind: "PERSON", label: "Wellness visitor", skill: "WELLNESS_VISITS", credentials: ["BACKGROUND_CHECK"], rationale: "Visiting a possibly vulnerable person alone requires a background check." },
        { key: "visit-2", kind: "PERSON", label: "Wellness visitor (buddy, first aid)", skill: "FIRST_AID", credentials: ["BACKGROUND_CHECK", "FIRST_AID_CPR"], rationale: "Two-person rule; one visitor must hold First Aid/CPR." },
      ];
    case "GENERATOR_POWER":
      return [
        {
          key: "electrician",
          kind: "PERSON",
          label: "Licensed electrician",
          skill: "ELECTRICAL",
          credentials: ["LICENSED_ELECTRICIAN"],
          training: ["GENERATOR_CO_SAFETY"],
          rationale: "Connecting a generator to a building's wiring without a transfer switch can back-feed and kill line workers; only a licensed electrician may do it.",
        },
        { key: "generator", kind: "ASSET", label: "Portable generator", asset: "GENERATOR", rationale: "Runs outdoors only, away from doors and windows (CO risk)." },
      ];
    case "SHELTER_STAFFING":
      return [
        { key: "shelter-1", kind: "PERSON", label: "Shelter volunteer", skill: "GENERAL_LABOR", credentials: ["BACKGROUND_CHECK"], training: ["PSYCH_FIRST_AID_INTRO"], rationale: "Shelters house children and vulnerable adults: background check and psychological first aid required." },
        { key: "shelter-2", kind: "PERSON", label: "Shelter volunteer", skill: "GENERAL_LABOR", credentials: ["BACKGROUND_CHECK"], training: ["PSYCH_FIRST_AID_INTRO"], rationale: "Two volunteers per shift." },
      ];
  }
}

export function deriveRequirements(a: Assessment, needTypes: NeedType[] = a.needs): RequirementSlot[] {
  const byKey = new Map<string, RequirementSlot>();
  const vulnerableHousehold = a.vulnerabilities.some((v) => VULNERABLE_OCCUPANT.includes(v));

  for (const need of needTypes) {
    for (const t of templatesFor(need, a)) {
      const quantity = typeof t.quantity === "function" ? t.quantity(a) : t.quantity ?? 1;
      const existing = byKey.get(t.key);
      if (existing) {
        existing.quantity = Math.max(existing.quantity, quantity);
        if (!t.optional) existing.optional = undefined;
        existing.credentials = Array.from(new Set([...existing.credentials, ...(t.credentials ?? [])]));
        existing.training = Array.from(new Set([...existing.training, ...(t.training ?? [])]));
        if (!existing.derivedFrom.includes(need)) existing.derivedFrom += `, ${need}`;
        continue;
      }
      byKey.set(t.key, {
        id: t.key,
        kind: t.kind,
        label: t.label,
        skill: t.skill,
        credentials: [...(t.credentials ?? [])],
        training: [...(t.training ?? [])],
        asset: t.asset,
        quantity,
        accessibleRequired: t.accessibleRequired,
        derivedFrom: need,
        rationale: t.rationale,
        ...(t.optional ? { optional: true } : {}),
      });
    }
  }

  const slots = Array.from(byKey.values());

  // R-V01: vulnerable-occupant rule — every person on-site must be background-checked.
  if (vulnerableHousehold) {
    for (const s of slots) {
      if (s.kind === "PERSON" && !s.credentials.includes("BACKGROUND_CHECK")) {
        s.credentials.push("BACKGROUND_CHECK");
        s.rationale += " Household includes a vulnerable occupant (rule R-V01): background check required.";
      }
    }
  }

  // People first, then equipment — stable order for display and team formation.
  return [...slots.filter((s) => s.kind === "PERSON"), ...slots.filter((s) => s.kind === "ASSET")];
}

/** Triage + requirements in one deterministic pass. */
export function assessIncident(input: {
  assessment: Assessment;
  immediateDangerReported: boolean;
  clearances: HazardClearance[];
  /** Needs on a community-mission path (navigator); defaults to every validated need. */
  missionNeeds?: NeedType[];
  now: Date;
}): { triage: TriageResult; requirements: RequirementSlot[] } {
  const first = triage(input);
  if (!first.civilianDispatchAllowed) return { triage: first, requirements: [] };
  const requirements = deriveRequirements(input.assessment, input.missionNeeds);
  return { triage: triage({ ...input, requirements }), requirements };
}
