import type { Credential, CredentialType, Responder } from "@/domain/types";

/**
 * Credential validity at a point in time. Only VERIFIED, unexpired records count.
 * PENDING records (submitted, not yet checked) never satisfy a requirement.
 */
export function credentialState(
  r: Pick<Responder, "credentials">,
  type: CredentialType,
  now: Date,
): { valid: boolean; credential?: Credential; reason: string } {
  const matches = r.credentials.filter((c) => c.type === type);
  if (matches.length === 0) return { valid: false, reason: "no record" };
  const verified = matches.find((c) => c.status === "VERIFIED" && (!c.expiresAt || new Date(c.expiresAt) > now));
  if (verified) return { valid: true, credential: verified, reason: "verified" };
  const c = matches[0];
  if (c.status === "VERIFIED" && c.expiresAt && new Date(c.expiresAt) <= now) {
    return { valid: false, credential: c, reason: `expired ${c.expiresAt.slice(0, 10)}` };
  }
  return { valid: false, credential: c, reason: c.status.toLowerCase() };
}

export const READINESS_LEVELS = [
  { level: 0, name: "Registered", description: "Profile created." },
  { level: 1, name: "Verified", description: "Identity verified and orientation complete." },
  { level: 2, name: "Deployable", description: "Background check verified plus one safety module." },
  { level: 3, name: "Trained responder", description: "Holds a recognized external credential (CERT, First Aid/CPR, …)." },
  { level: 4, name: "Specialist", description: "Specialist credential (chainsaw, roof, accessible transport, licensed trade) and 3+ verified missions." },
] as const;

const EXTERNAL_TRAINING: CredentialType[] = ["CERT_BASIC", "FIRST_AID_CPR", "CHAINSAW_SAFETY", "ROOF_FALL_PROTECTION", "WHEELCHAIR_SECUREMENT", "LICENSED_ELECTRICIAN", "FOOD_HANDLER"];
const SPECIALIST: CredentialType[] = ["CHAINSAW_SAFETY", "ROOF_FALL_PROTECTION", "WHEELCHAIR_SECUREMENT", "LICENSED_ELECTRICIAN"];

/** Deterministic readiness level for a person (organizations are rated by verification only). */
export function readinessLevel(r: Responder, now: Date): { level: number; name: string; next?: string } {
  const has = (t: CredentialType) => credentialState(r, t, now).valid;
  const trained = (m: string) => r.training.some((t) => t.moduleId === m);
  let level = 0;
  if (r.identityVerified && (r.kind === "ORGANIZATION" || trained("ORIENTATION"))) level = 1;
  if (level >= 1 && has("BACKGROUND_CHECK") && (r.kind === "ORGANIZATION" || r.training.some((t) => t.moduleId !== "ORIENTATION"))) level = 2;
  if (level >= 2 && EXTERNAL_TRAINING.some(has)) level = 3;
  if (level >= 3 && SPECIALIST.some(has) && r.stats.missionsCompleted >= 3) level = 4;
  const next = level < 4 ? READINESS_LEVELS[level + 1].description : undefined;
  return { level, name: READINESS_LEVELS[level].name, next };
}
