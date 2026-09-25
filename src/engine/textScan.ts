import type { Hazard, HazardMention, NeedType, Vulnerability } from "@/domain/types";

/**
 * Deterministic text scanners.
 *
 * The hazard scanner runs on EVERY request regardless of what the AI says
 * (defense in depth): the AI can add hazards, but it can never remove one the
 * scanner finds. The scanner is intentionally conservative — a false positive
 * costs a coordinator review; a false negative could put a volunteer next to
 * an energized line.
 */

const HAZARD_PATTERNS: Record<Hazard, RegExp[]> = {
  DOWNED_POWER_LINE: [
    /\bpower ?lines?\b/gi,
    /\belectric(?:al)? (?:lines?|wires?|cables?)\b/gi,
    /\blive wires?\b/gi,
    /\bdowned (?:lines?|wires?)\b/gi,
    /\bwires? (?:are |is )?(?:down|sparking|arcing|on the ground|in the (?:road|yard|water))\b/gi,
    /\bsparking\b/gi,
    /\btransformer\b/gi,
  ],
  GAS_LEAK: [
    /\bsmell(?:s|ing)? (?:of )?(?:natural )?gas\b/gi,
    /\bgas (?:leak|smell|odou?r)\b/gi,
    /\bpropane (?:leak|smell|odou?r)\b/gi,
    /\bhissing\b/gi,
    /\bsmells? like (?:rotten )?eggs\b/gi,
  ],
  ACTIVE_FIRE: [
    /\bfire\b(?! (?:department|station|hydrant|pit|company|marshal|chief|truck|fighters?))/gi,
    /\bflames?\b/gi,
    /\bon fire\b/gi,
    /\bburning\b/gi,
    /\bsmoke (?:is )?(?:coming|pouring|filling|billowing)\b/gi,
  ],
  VIOLENCE: [
    /\bguns?\b/gi,
    /\bweapons?\b/gi,
    /\bshots? fired\b/gi,
    /\bshooting\b/gi,
    /\bstabb?(?:ed|ing)\b/gi,
    /\bassault(?:ed|ing)?\b/gi,
    /(?<!heart )\battack(?:ed|ing)?\b/gi,
    /\bthreaten(?:ed|ing)?\b/gi,
    /\bfight(?:ing)?\b/gi,
    /\bviolen(?:t|ce)\b/gi,
    /\blooting\b/gi,
    /\bintruders?\b/gi,
  ],
  UNSTABLE_STRUCTURE: [
    /\bcollaps(?:e|ed|ing)\b/gi,
    /\bcav(?:ed|ing) in\b/gi,
    /\bstructural(?:ly)?\b/gi,
    /\bleaning\b/gi,
    /\bfoundation (?:is |has )?(?:crack|shift|wash|undermin)\w*/gi,
    /\bsagging\b/gi,
    /\b(?:wall|ceiling|floor)s? (?:is |are )?(?:cracked|cracking|buckl\w*|bowing|giving way)\b/gi,
    /\bunsafe to enter\b/gi,
    /\babout to (?:fall|come down|give way)\b/gi,
  ],
  HAZARDOUS_MATERIALS: [
    /\bchemicals?\b/gi,
    /\bhazmat\b/gi,
    /\b(?:drums?|barrels?|tanks?) (?:are |is )?(?:floating|leaking|washed)\b/gi,
    /\bfloating (?:drums?|barrels?|tanks?)\b/gi,
    /\b(?:fuel|oil|diesel|gasoline) (?:spill|leak|sheen|slick|smell)\w*/gi,
    /\basbestos\b/gi,
  ],
  SWIFT_WATER: [
    /\bswift(?:[- ]water)?\b/gi,
    /\bswept (?:away|off)\b/gi,
    /\bstrong current\b/gi,
    /\bstranded (?:in|by|on) (?:a |the |my |our |their )?(?:flood ?water|water|car|vehicle|roof)\b/gi,
    /\btrapped (?:by|in) (?:the )?(?:flood ?)?water\b/gi,
    /\b(?:car|truck|vehicle|van) (?:is |was |got )?(?:stuck |stalled )?(?:in|under) (?:the |deep )?(?:flood ?)?water\b/gi,
    /\bstuck in (?:the )?(?:flood|water)\b/gi,
    /\b(?:we're|we are|they're|they are|stuck|trapped|climbed|waiting) (?:up )?(?:on|onto) (?:the|our|my|their) roof\b/gi,
    /\bwater (?:is )?rising (?:fast|quickly|rapidly)\b/gi,
    /\bwater (?:is )?up to (?:my|our|his|her|their|the) (?:waist|chest|neck)\b/gi,
    /\bwater rescue\b/gi,
  ],
  MEDICAL_EMERGENCY: [
    /\bnot breathing\b/gi,
    /\b(?:can't|cannot|can not|trouble|difficulty) breath(?:e|ing)\b/gi,
    /\bunconscious\b/gi,
    /\bunresponsive\b/gi,
    /\b(?:isn't|is not|not) responding\b/gi,
    /\bchest pains?\b/gi,
    /\bheart attack\b/gi,
    /\bstroke\b/gi,
    /\bseizures?\b/gi,
    /\bbleeding\b/gi,
    /\bbroken (?:leg|arm|bone|hip|neck|back)\b/gi,
    /\boverdose\b/gi,
    /\bhead injury\b/gi,
    /\bhit (?:his|her|their|my) head\b/gi,
    /\b(?:is |was |got |badly |seriously )(?:hurt|injured)\b/gi,
    /\b(?:he|she|they|dad|mom|mother|father|husband|wife|grandma|grandpa|grandmother|grandfather|someone|neighbou?r|son|daughter) fell\b/gi,
  ],
};

/** Hazards whose negated mention still warrants a coordinator acknowledgement. */
const REVIEW_ON_NEGATION: Hazard[] = [
  "DOWNED_POWER_LINE",
  "GAS_LEAK",
  "ACTIVE_FIRE",
  "UNSTABLE_STRUCTURE",
  "HAZARDOUS_MATERIALS",
  "SWIFT_WATER",
  "VIOLENCE",
];

/**
 * Phrases that can legitimately be negated ("nobody is hurt"). Every other
 * medical phrase — unconscious, chest pain, not breathing, seizure… — is
 * NEVER treated as negated: a false alarm costs a 911 handoff, a missed one
 * costs a life.
 */
const NEGATABLE_MEDICAL = /^(?:is |was |got |badly |seriously )(?:hurt|injured)$|fell$/i;

const NEGATION = /\b(?:no|not|nobody|none|never|without|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|no-one|nothing|no one)\b/i;

/** Clause boundaries: sentence punctuation, commas and coordinating conjunctions. */
const CLAUSE_BREAK = /[.!?;,:()\n]|\b(?:and|but|or|so|because|while|although|though|then|also|plus)\b/i;

function isNegated(text: string, index: number): boolean {
  // Only a negation in the same clause, within the three words right before the hazard phrase, counts.
  const before = text.slice(Math.max(0, index - 80), index);
  const parts = before.split(CLAUSE_BREAK);
  const clause = parts[parts.length - 1] ?? "";
  const words = clause.trim().split(/\s+/).filter(Boolean).slice(-3).join(" ");
  return NEGATION.test(words);
}

export function scanHazards(text: string): HazardMention[] {
  const mentions: HazardMention[] = [];
  for (const [hazard, patterns] of Object.entries(HAZARD_PATTERNS) as [Hazard, RegExp[]][]) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const negatable = hazard !== "MEDICAL_EMERGENCY" || NEGATABLE_MEDICAL.test(m[0]);
        mentions.push({ hazard, phrase: m[0], negated: negatable && isNegated(text, m.index) });
      }
    }
  }
  return mentions;
}

export function assertedHazards(mentions: HazardMention[]): Hazard[] {
  return unique(mentions.filter((m) => !m.negated).map((m) => m.hazard));
}

/** Hazards mentioned only in negated form ("no power lines down") that need human confirmation. */
export function negatedHazardsNeedingReview(mentions: HazardMention[]): HazardMention[] {
  const asserted = new Set(assertedHazards(mentions));
  const seen = new Set<Hazard>();
  return mentions.filter((m) => {
    if (!m.negated || asserted.has(m.hazard) || !REVIEW_ON_NEGATION.includes(m.hazard) || seen.has(m.hazard)) return false;
    seen.add(m.hazard);
    return true;
  });
}

const VULNERABILITY_PATTERNS: Record<Vulnerability, RegExp[]> = {
  MOBILITY_LIMITED: [
    /\bwheel ?chairs?\b/i,
    /\bwalker\b/i,
    /\bcan(?:'t|not| not) (?:walk|carry|lift|climb|get up)\b/i,
    /\bmobility\b/i,
    /\bbed(?:ridden|-bound| bound)\b/i,
    /\bparaly[sz]\w*/i,
    /\bamputee\b/i,
    /\buses a cane\b/i,
  ],
  MEDICAL_DEPENDENCY: [
    /\boxygen\b/i,
    /\bdialysis\b/i,
    /\binsulin\b/i,
    /\bc-?pap\b|\bbi-?pap\b/i,
    /\bventilator\b/i,
    /\bnebuli[sz]er\b/i,
    /\bmedical (?:device|equipment)\b/i,
    /\bfeeding tube\b/i,
    /\bchemo\w*/i,
  ],
  OLDER_ADULT: [
    /\belderly\b/i,
    /\bsenior\b/i,
    /\b(?:6[5-9]|[7-9]\d|10\d)[- ]?(?:years?[- ]old|yo|y\/o)\b/i,
    /\b(?:she|he|they|mother|father|mom|dad|aunt|uncle|grandmother|grandfather|neighbou?r|husband|wife)(?:'s| is| are) (?:6[5-9]|[7-9]\d|10\d)\b/i,
    /\bgrand(?:mother|father|ma|pa)\b/i,
    /\bage[ds]? (?:6[5-9]|[7-9]\d|10\d)\b/i,
  ],
  CHILDREN: [/\bkids?\b/i, /\bchild(?:ren)?\b/i, /\bbab(?:y|ies)\b/i, /\binfants?\b/i, /\btoddlers?\b/i, /\bnewborn\b/i, /\bformula\b/i, /\bdiapers?\b/i],
  ISOLATED: [/\blives? alone\b/i, /\bliving alone\b/i, /\bby (?:herself|himself|themselves|themself)\b/i, /\bno (?:family|one) (?:nearby|around|to help)\b/i],
  LANGUAGE_ACCESS: [/\bonly speaks?\b/i, /\b(?:doesn't|does not|don't|do not) speak english\b/i, /\bno english\b/i, /\bespañol\b/i, /\bspanish[- ]speaking\b/i, /\binterpreter\b/i],
  DISABILITY_OTHER: [/\bdeaf\b/i, /\bblind\b/i, /\bhard of hearing\b/i, /\bautis\w*/i, /\bdementia\b/i, /\balzheimer\w*/i],
};

/** The phrase that shows each vulnerability, when it came from the resident's words. */
export function scanVulnerabilityEvidence(text: string): Partial<Record<Vulnerability, string>> {
  const out: Partial<Record<Vulnerability, string>> = {};
  for (const [v, patterns] of Object.entries(VULNERABILITY_PATTERNS) as [Vulnerability, RegExp[]][]) {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) {
        out[v] = m[0];
        break;
      }
    }
  }
  return out;
}

export function scanVulnerabilities(text: string): Vulnerability[] {
  return (Object.entries(VULNERABILITY_PATTERNS) as [Vulnerability, RegExp[]][])
    .filter(([, patterns]) => patterns.some((re) => re.test(text)))
    .map(([v]) => v);
}

const NEED_PATTERNS: Record<NeedType, RegExp[]> = {
  TREE_CUTTING: [/\btrees?\b/i, /\blimbs?\b/i, /\btrunk\b/i, /\bbranch(?:es)?\b/i],
  DEBRIS_REMOVAL: [/\bdebris\b/i, /\blimbs?\b/i, /\bbranch(?:es)?\b/i, /\bbrush\b/i, /\bhaul (?:away|off)\b/i],
  ACCESS_BLOCKED: [
    /\bblock(?:ed|ing|s)\b/i,
    /\bcan(?:'t|not| not) (?:leave|get out|get in|drive out|get to (?:the )?road)\b/i,
    /\bacross (?:the|our|my) (?:driveway|road|lane|street)\b/i,
  ],
  WATER_MITIGATION: [
    /\bbasement\b/i,
    /\bwater (?:is )?(?:coming|getting|got|seeping|pouring|leaking) in\w*/i,
    /\b(?:house|home|basement|apartment|first floor|kitchen|living room|crawl ?space) (?:is |was |got |has )?(?:flooded|flooding)\b/i,
    /\bflooded (?:basement|house|home|first floor|crawl ?space)\b/i,
    /\bstanding water\b/i,
    /\bpump(?:ing)? (?:out|water)\b/i,
    /\bfilling (?:up )?with water\b/i,
  ],
  MUCK_OUT: [/\bmuck\w*/i, /\bdrywall\b/i, /\b(?:carpet|flooring|insulation) (?:is |are )?(?:soaked|ruined|wet)\b/i, /\bmold\b/i, /\btear[- ]out\b/i, /\bgut(?:ted|ting)?\b/i],
  MOVE_BELONGINGS: [
    /\bmove (?:our|my|her|his|their|the)? ?(?:stuff|belongings|furniture|things|boxes)\b/i,
    /\bget (?:our|my|her|his|their) (?:stuff|things|belongings)\b/i,
    /\bcarry (?:things|stuff|boxes|anything)\b/i,
    /\bcan(?:'t|not| not) carry\b/i,
    /\bupstairs\b/i,
  ],
  ROOF_TARP: [/\broof\b/i, /\btarp\w*/i, /\bhole in (?:the|our|my) (?:roof|ceiling)\b/i, /\brain (?:is )?coming in\b/i, /\bceiling (?:is )?leaking\b/i],
  FOOD: [/\bfood\b/i, /\bmeals?\b/i, /\bgroceries\b/i, /\bhungry\b/i, /\bformula\b/i],
  WATER: [/\bdrinking water\b/i, /\bbottled water\b/i, /\bno (?:clean |safe )?water\b/i, /\bwater to drink\b/i, /\bclean water\b/i],
  MEDICATION: [/\bmedications?\b/i, /\bmedicine\b/i, /\bprescriptions?\b/i, /\bpharmacy\b/i, /\brefills?\b/i],
  POWER_MEDICAL_DEVICE: [/\boxygen (?:concentrator|machine)\b/i, /\bconcentrator\b/i, /\bc-?pap\b/i, /\bbi-?pap\b/i, /\bventilator\b/i, /\bnebuli[sz]er\b/i, /\bon oxygen\b/i, /\bmedical (?:device|equipment)\b/i],
  DEVICE_CHARGING: [/\bcharg(?:e|ing|er)\b/i, /\bphones? (?:is |are )?dead\b/i, /\bdead phones?\b/i, /\bcan(?:'t|not) call\b/i],
  REFRIGERATION: [/\binsulin\b/i, /\brefrigerat\w*/i, /\bkeep (?:it |them |medicine )?cold\b/i, /\bfridge\b/i],
  TRANSPORTATION: [
    /\b(?:need|needs|get) a ride\b/i,
    /\btransport(?:ation)?\b/i,
    /\bget (?:her|him|them|me|us)? ?to (?:the )?(?:shelter|hospital|dialysis|pharmacy|appointment|clinic|doctor)\b/i,
    /\bevacuat\w*/i,
    /\bno (?:car|vehicle|way to get)\b/i,
    /\b(?:car|van|vehicle) (?:is |was |got )?(?:flooded|totaled|destroyed)\b/i,
  ],
  SHELTER: [/\bwhere (?:can|should|do) (?:we|i) (?:go|stay|sleep)\b/i, /\bstay tonight\b/i, /\bplace to stay\b/i, /\bsomewhere to (?:stay|sleep)\b/i, /\bshelter\b/i, /\bdisplaced\b/i, /\bnowhere to (?:go|stay)\b/i, /\bcan(?:'t|not) stay\b/i, /\buninhabitable\b/i],
  WELLNESS_CHECK: [/\bcheck on\b/i, /\bhaven'?t (?:seen|heard)\b/i, /\bnot answering\b/i, /\bno one has heard\b/i, /\bwel(?:l|fare)(?:ness)? check\b/i, /\bwellbeing\b/i],
  GENERATOR_POWER: [/\btransfer switch\b/i, /\b(?:hook|wire|connect)\w* (?:up )?(?:a |the |our |their )?(?:donated |portable |backup )?generator\b/i, /\bgenerator\b[^.]{0,60}\b(?:hook(?:ed)?[- ]?up|connect\w*|wir(?:e|ed|ing))\b/i],
  SHELTER_STAFFING: [/\b(?:shelter|cooling (?:center|site)|warming (?:center|site))\b[^.]{0,60}\b(?:staff\w*|short[- ]?handed|overnight shifts?|volunteers? to (?:run|staff|help run))\b/i, /\b(?:staff|volunteers?) (?:for|at) (?:the )?(?:shelter|cooling center|warming center)\b/i],
  // Derived by the navigator from hazards / triage — never from wording alone.
  EMERGENCY_RESPONSE: [],
  HAZARD_RESPONSE: [],
  ROAD_CONDITION: [],
  GENERAL_GUIDANCE: [],
  UTILITY_OUTAGE: [
    /\b(?:power|electricity) (?:is |has been |went |has gone |was |has )?(?:out|off|down)\b/i,
    /\bno (?:power|electricity)\b/i,
    /\blost (?:the )?(?:power|electricity)\b/i,
    /\b(?:power|electric(?:al)?) outage\b/i,
  ],
  DISASTER_ASSISTANCE: [
    /\bfema\b/i,
    /\bdisaster (?:assistance|aid|relief|loans?)\b/i,
    /\bpay for (?:the )?(?:repairs?|damage|a hotel)\b/i,
    /\binsurance\b/i,
    /\bfinancial (?:help|assistance)\b/i,
    /\bhelp (?:with|paying for) (?:the )?(?:damage|repairs?|costs?)\b/i,
  ],
  RECOVERY_CASEWORK: [
    /\blost everything\b/i,
    /\b(?:house|home|apartment) (?:is |was )?(?:destroyed|condemned|a total loss|gone)\b/i,
    /\bdon'?t know (?:what to do|where to (?:start|turn))\b/i,
    /\bcase ?(?:worker|manager)\b/i,
  ],
  EMOTIONAL_SUPPORT: [
    /\b(?:scared|terrified|anxious|panick(?:ed|ing)|overwhelmed|traumati[sz]ed)\b/i,
    /\bcan'?t (?:cope|stop crying|sleep)\b/i,
    /\bsomeone to talk to\b/i,
  ],
};

const CRISIS = /\b(?:kill (?:myself|me)|suicid\w*|end (?:my life|it all)|want to die|don'?t want to (?:live|be alive)|no reason to live)\b/i;

/** Words suggesting someone may harm themselves. Routes to 988 and a person, never to a volunteer. */
export function scanCrisis(text: string): string | undefined {
  return CRISIS.exec(text)?.[0];
}

const HOMEBOUND =
  /\bcan(?:'t|not| not) (?:drive|leave|get out|get to (?:the )?(?:store|road)|go out)\b|\bno (?:car|vehicle|way to get (?:there|out))\b|\b(?:road|lane|street|bridge) (?:is |was )?(?:washed out|closed|blocked|flooded|under ?water)\b|\bhomebound\b|\bhouse-?bound\b|\bstuck (?:at home|inside|here)\b/i;

/** The household cannot travel to a distribution point (in its own words). */
export function scanHomebound(text: string): string | undefined {
  return HOMEBOUND.exec(text)?.[0];
}

/** The first phrase in the text that supports each scanned need (evidence shown to residents and coordinators). */
export function scanNeedEvidence(text: string): Partial<Record<NeedType, string>> {
  const out: Partial<Record<NeedType, string>> = {};
  for (const n of scanNeeds(text)) {
    for (const re of NEED_PATTERNS[n]) {
      const m = re.exec(text);
      if (m) {
        out[n] = m[0];
        break;
      }
    }
  }
  return out;
}

export function scanNeeds(text: string): NeedType[] {
  const needs = (Object.entries(NEED_PATTERNS) as [NeedType, RegExp[]][])
    .filter(([, patterns]) => patterns.some((re) => re.test(text)))
    .map(([n]) => n);
  // A roof limb is roof protection, not tree felling on the ground.
  if (needs.includes("ROOF_TARP") && needs.includes("TREE_CUTTING") && !/\b(?:driveway|road|yard|lane|across)\b/i.test(text)) {
    return needs.filter((n) => n !== "TREE_CUTTING" && n !== "DEBRIS_REMOVAL");
  }
  // A shelter asking for staff is not a household asking for a bed.
  if (needs.includes("SHELTER_STAFFING") && needs.includes("SHELTER") && !/\bplace to stay|somewhere to (?:stay|sleep)|nowhere to|displaced\b/i.test(text)) {
    return needs.filter((n) => n !== "SHELTER");
  }
  // "shelter" in "get to the shelter" is transportation, not a placement request.
  if (needs.includes("SHELTER") && needs.includes("TRANSPORTATION") && /\bto (?:the )?shelter\b/i.test(text) && !/\bplace to stay|somewhere to|nowhere to|displaced\b/i.test(text)) {
    return needs.filter((n) => n !== "SHELTER");
  }
  return needs;
}

/* ------------------------------------------------------------------ */
/* Information-only reports (rule R-I01)                               */
/* ------------------------------------------------------------------ */

const REPORT_ONLY: RegExp[] = [
  /\bjust (?:letting (?:you|y'all|everyone|folks) know|reporting|a heads[- ]up|fyi)\b/i,
  /\bheads[- ]up\b/i,
  /\bfyi\b/i,
  /\bno help (?:is )?needed\b/i,
  /\b(?:don't|do not|dont) need (?:any )?help\b/i,
  /\bfor your (?:information|awareness)\b/i,
  /\bwanted to report\b/i,
];
const PUBLIC_WAY = /\b(?:road|rd|street|st|avenue|ave|lane|ln|drive|dr|route|rte|highway|hwy|bridge|intersection|both lanes|underpass)\b/i;
const ROAD_CONDITION = /\b(?:blocked|blocking|closed|flooded|under ?water|impassable|washed out|down across|across (?:both|all|the) lanes?|water (?:is )?(?:over|across) the road|standing water|debris)\b/i;
const PERSONAL_NEED =
  /\b(?:we|i) (?:need|can'?t|cannot|are stuck|am stuck|are trapped|am trapped)\b|\bhelp (?:us|me)\b|\bplease (?:send|help)\b|\b(?:my|our) (?:house|home|driveway|yard|roof|basement|car|truck|family|street|lane|kids?|mother|father|mom|dad)\b|\b(?:stuck|trapped|stranded)\b/i;

/** True when the text asks someone for help for themselves (never information-only). */
export function mentionsPersonalNeed(text: string): boolean {
  return PERSONAL_NEED.test(text);
}

/**
 * The reporter describes a public road/area condition AND explicitly says it is
 * just a report. Both are required; any personal need wins.
 */
export function scanInformationOnly(text: string): boolean {
  return REPORT_ONLY.some((re) => re.test(text)) && PUBLIC_WAY.test(text) && ROAD_CONDITION.test(text) && !mentionsPersonalNeed(text);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};

export function scanPeopleCount(text: string): number | undefined {
  const toNum = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUMBER_WORDS[s.toLowerCase()]);
  const family = /\bfamily of (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(text);
  if (family) return toNum(family[1]);
  const group = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve) (?:of us|people|adults|residents|households|families|neighbou?rs)\b/i.exec(text);
  if (group) return toNum(group[1]);
  if (/\b(?:my|our) (?:mother|mom|father|dad|husband|wife|partner|son|daughter) and (?:i|me)\b/i.test(text)) return 2;
  if (/\b(?:we|us|our)\b/i.test(text)) return 2;
  return undefined;
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
