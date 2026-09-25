import type { Assessment, Priority, PriorityLevel, TriageResult } from "@/domain/types";

/**
 * Deterministic priority score. Transparent additive factors so a
 * coordinator can explain any ranking in one sentence.
 */
export function computePriority(a: Assessment, t: TriageResult): Priority {
  const factors: string[] = [];
  let score: number;

  if (t.level === "LIFE_SAFETY_EMERGENCY") {
    return { level: "P1", score: 100, factors: ["Life-safety emergency (+100)"] };
  }
  if (t.level === "INFORMATION_ONLY") {
    return { level: "P4", score: 5, factors: ["Information-only report — no assistance requested (+5)"] };
  }
  if (t.level === "PROFESSIONAL_RESPONSE_REQUIRED") {
    score = 80;
    factors.push("Hazard requiring professional response (+80)");
  } else {
    score = 20;
    factors.push("Civilian-eligible baseline (+20)");
  }

  const add = (cond: boolean, pts: number, label: string) => {
    if (cond) {
      score += pts;
      factors.push(`${label} (+${pts})`);
    }
  };

  const v = new Set(a.vulnerabilities);
  const n = new Set(a.needs);
  add(n.has("POWER_MEDICAL_DEVICE"), 50, "Power for life-sustaining medical device");
  add(n.has("REFRIGERATION") && v.has("MEDICAL_DEPENDENCY"), 20, "Temperature-sensitive medication");
  add(v.has("MEDICAL_DEPENDENCY") && !n.has("POWER_MEDICAL_DEVICE"), 10, "Medical dependency");
  add(v.has("MOBILITY_LIMITED"), 15, "Limited mobility");
  add(v.has("OLDER_ADULT"), 10, "Older adult");
  add(v.has("CHILDREN"), 10, "Children in household");
  add(v.has("ISOLATED"), 10, "Isolated resident");
  add(n.has("ACCESS_BLOCKED"), 15, "Household cannot leave");
  add(n.has("SHELTER"), 15, "Needs shelter tonight");
  add(n.has("WELLNESS_CHECK"), 15, "Resident unreachable");
  add(n.has("WATER") || n.has("FOOD"), 10, "Lacks food or water");
  add(n.has("ROOF_TARP"), 10, "Active water intrusion through roof");
  add(n.has("WATER_MITIGATION"), 10, "Water entering the home");
  add(n.has("TRANSPORTATION") && v.has("MEDICAL_DEPENDENCY"), 10, "Transport to medical care");
  add(v.has("LANGUAGE_ACCESS"), 5, "Language access need");
  add(n.has("GENERATOR_POWER"), 15, "Community facility without power");
  add(n.has("SHELTER_STAFFING"), 15, "Shelter operating short-staffed");
  add(a.peopleAffected >= 4, 5, `${a.peopleAffected} people affected`);

  score = Math.min(score, 100);
  return { level: levelFor(score), score, factors };
}

export function levelFor(score: number): PriorityLevel {
  if (score >= 70) return "P1";
  if (score >= 50) return "P2";
  if (score >= 35) return "P3";
  return "P4";
}
