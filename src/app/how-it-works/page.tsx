import { ArrowRight, BookOpen, Bot, Check, Compass, Cloud, Database, Map, Radio, ShieldCheck, Sparkles, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, Pill } from "@/components/ui";
import { ESCALATION_LABELS, TRIAGE_LABELS } from "@/domain/catalog";
import { TRIAGE_LEVELS } from "@/domain/types";
import { ASSISTANCE_DIRECTORY } from "@/data/assistanceDirectory";
import { CORRELATION_RULES } from "@/engine/correlate";
import { NAVIGATOR_RULES } from "@/engine/navigator";
import { SCORE_WEIGHTS } from "@/engine/matching";
import { REASSESSMENT_RULES } from "@/engine/reassess";
import { HAZARD_RULES, POLICY_RULES } from "@/engine/rules";
import { PROVIDERS } from "@/providers/registry";

export const metadata: Metadata = { title: "How it works" };

const PIPELINE = [
  { name: "Request", who: "Resident", tone: "bg-general-soft text-general" },
  { name: "AI interpretation", who: "Azure AI Foundry", tone: "bg-brand text-white" },
  { name: "Validation", who: "Deterministic", tone: "bg-ink text-white" },
  { name: "Safety triage", who: "Deterministic", tone: "bg-ink text-white" },
  { name: "Needs → resolution paths", who: "Navigator rules", tone: "bg-ink text-white" },
  { name: "Guidance & trusted services", who: "Directory + rules", tone: "bg-ink text-white" },
  { name: "Resident requests help", who: "Resident's choice", tone: "bg-general-soft text-general" },
  { name: "Capabilities", who: "Deterministic", tone: "bg-ink text-white" },
  { name: "Gated matching", who: "Deterministic", tone: "bg-ink text-white" },
  { name: "Team formation", who: "Deterministic", tone: "bg-ink text-white" },
  { name: "Route & conditions", who: "Deterministic", tone: "bg-ink text-white" },
  { name: "Dispatch", who: "Human coordinator + gate", tone: "bg-forming text-white" },
  { name: "Continuous reassessment", who: "Rules; people resume", tone: "bg-ink text-white" },
  { name: "Mission & verify", who: "Volunteers + resident", tone: "bg-active text-white" },
];

const GATES = [
  ["Safety", "Triage must permit a civilian mission."],
  ["Identity", "Person identity / organization legitimacy verified."],
  ["Availability", "Not marked off duty."],
  ["Capacity", "Not deployed on another active mission; equipment not already committed."],
  ["Skill", "Holds the role's skill."],
  ["Credentials", "Every required credential VERIFIED and unexpired (pending never counts)."],
  ["Training", "Required CoORDINATE modules completed."],
  ["Equipment", "Owns the asset type, accessible if required, in sufficient quantity."],
  ["Travel range", "Incident is within the responder's own travel radius."],
];

const SPLIT: [string, string, string][] = [
  ["Turn free text (and optional photo) into a structured proposal", "AI", "Azure AI Foundry, JSON output, temperature 0"],
  ["Decide whether a hazard is present", "Both — union", "AI may add hazards; keyword scanner and resident answers can never be overridden"],
  ["Split one situation into separate needs, quoting the words behind each", "Both — union", "Foundry proposes needs with verbatim quotes (quotes not in the text are dropped); the keyword scanner's findings are always kept"],
  ["Decide whether civilians may respond at all", "Rules", "Hazard rule table + immediate-danger rule"],
  ["Choose each need's resolution path", "Rules", "Navigator rules N-01 … N-15: information, referral, human escalation, professional response, community mission, resource transfer, situational awareness"],
  ["Recommend trusted services", "Rules", "Trusted Assistance Directory filtered by service area, type and eligibility — every entry carries its source"],
  ["Ask for coordinated community help", "Human", "The resident (or a coordinator on their behalf) chooses which needs — nothing is staffed before that"],
  ["Write the handoff summary (why / who / what)", "AI", "Foundry drafts on request from structured facts; wording policy enforced; template fallback. Nothing is sent"],
  ["Decide which roles, credentials and equipment are needed", "Rules", "Need → role templates, vulnerable-occupant rule"],
  ["Decide who is eligible", "Rules", "Nine pass/fail gates"],
  ["Rank eligible candidates", "Rules", "Transparent weighted score, reasons attached"],
  ["Decide whether an outside report is actionable", "Rules", "Source authority + independent corroboration (A1–A4); news and camera AI never act alone"],
  ["Plan the route", "Rules", "Usable network = roads − known closures − restricted areas; Azure Maps travel times in live mode, re-checked against exact geometry"],
  ["Dispatch a team", "Human", "Authorized coordinator only, after the dispatch gate re-validates (including route and weather)"],
  ["Hold, reroute or suspend a mission in the field", "Rules", "Policy table W-01 … H-01, re-run whenever conditions change"],
  ["Resume a held mission", "Human", "Only after the rules record that the condition has cleared (H-01)"],
  ["Write the team briefing and the situation report", "AI", "Language tasks; deterministic safety lines always appended"],
  ["Verify completion", "Human", "Coordinator or the resident — never the team itself"],
];

const SIMULATED = [
  "Contact with 911, EMS, fire, law enforcement, utilities, building officials, HazMat, shelters and caseworkers: CoORDINATE only recommends escalation and prepares a handoff summary; a coordinator makes the call and records it",
  "Exercise-only assistance activations: open shelters, distribution points, accessible rides and the casework desk (labelled EXERCISE)",
  "Exercise conditions: NWS/IPAWS alerts, VDOT closures and cameras, public CAD, news and the opt-in doorbell camera (every item labelled SIMULATED)",
  "Sign-in: personas stand in for Microsoft Entra ID / Entra External ID",
  "SMS / push notifications to dispatched teams",
  "Background-check and credential registries (records are seeded; coordinators can verify pending uploads)",
  "The storm scenario, people, organizations and requests (all fictional)",
];

const REAL = [
  "Disaster assistance navigator: need decomposition, resolution-path rules, eligibility-aware service recommendations with provenance, and handoff summaries (unit-tested)",
  "Deterministic triage, requirement derivation, gated matching, team formation and dispatch gate (unit-tested)",
  "Multi-source correlation with provenance and staleness, restriction-aware routing and continuous mission reassessment (unit-tested)",
  "Live adapters for NWS, Azure Maps Traffic, Virginia 511 / VDOT, VDOT cameras, public CAD and news RSS; source health derived from real fetch results",
  "Azure AI Foundry: need extraction with verified quotes, briefing, handoff-summary and SITREP drafting, camera-frame classification — with automatic fallback",
  "Azure Cosmos DB persistence (partitioned by operation / sandbox) with in-memory fallback",
  "Azure Maps tiles and geocoding via a server-side proxy (key never reaches the browser)",
  "Audit timeline of every AI proposal, rule decision and human action",
  "REST API, per-visitor sandboxes, GitHub Actions deployment to Azure App Service",
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <div>
        <Pill className="bg-brand-soft text-brand">Responsible AI by design</Pill>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Navigate the person. Resolve the need. Coordinate the response.</h1>
        <p className="mt-1 text-lg font-semibold text-ink">AI interprets. Rules decide. People dispatch.</p>
        <p className="mt-2 max-w-3xl text-lg text-muted">
          CoORDINATE uses AI where language is messy and deterministic code where lives are at stake. The rule tables on this page are rendered from the same
          modules the engine executes.
        </p>
      </div>

      <Card className="p-4">
        <ol className="flex flex-wrap items-center gap-2" aria-label="Decision pipeline">
          {PIPELINE.map((p, i) => (
            <li key={p.name} className="flex items-center gap-2">
              <div className={`rounded-md px-3 py-2 text-center ${p.tone}`}>
                <div className="text-sm font-bold">{p.name}</div>
                <div className="text-[11px] opacity-90">{p.who}</div>
              </div>
              {i < PIPELINE.length - 1 ? <ArrowRight className="h-4 w-4 text-muted" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      </Card>

      <Card aria-labelledby="split-h">
        <CardHeader id="split-h" icon={<Sparkles className="h-4 w-4 text-brand" />} title="Who is responsible for what" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">Decision</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">How</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SPLIT.map(([d, owner, how]) => (
                <tr key={d}>
                  <td className="px-4 py-2 font-medium text-ink">{d}</td>
                  <td className="px-4 py-2">
                    <Pill className={owner === "AI" ? "bg-brand text-white" : owner === "Human" ? "bg-forming text-white" : owner === "Rules" ? "bg-ink text-white" : "bg-trained-soft text-trained"}>{owner}</Pill>
                  </td>
                  <td className="px-4 py-2 text-muted">{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="tiers-h">
          <CardHeader id="tiers-h" icon={<ShieldCheck className="h-4 w-4 text-active" />} title="Triage levels" />
          <ul className="divide-y divide-line">
            {TRIAGE_LEVELS.map((t) => (
              <li key={t} className="px-4 py-2.5 text-sm">
                <div className="font-semibold text-ink">{TRIAGE_LABELS[t].label}</div>
                <div className="text-muted">{TRIAGE_LABELS[t].description}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="gates-h">
          <CardHeader id="gates-h" icon={<Check className="h-4 w-4 text-done" />} title="Hard gates (all must pass)" subtitle="Rule R-M01: proximity is never consulted until every gate passes." />
          <ul className="divide-y divide-line text-sm">
            {GATES.map(([g, d]) => (
              <li key={g} className="flex gap-3 px-4 py-2">
                <span className="w-24 shrink-0 font-semibold text-ink">{g}</span>
                <span className="text-muted">{d}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card aria-labelledby="nav-h">
        <CardHeader id="nav-h" icon={<Compass className="h-4 w-4 text-brand" />} title="Navigator rules — every need gets a resolution path" subtitle="engine/navigator.ts. Only COMMUNITY_MISSION and RESOURCE_TRANSFER needs can reach the capability engine, and only after the resident asks." />
        <ul className="grid gap-x-6 divide-y divide-line text-sm md:grid-cols-2 md:divide-y-0">
          {NAVIGATOR_RULES.map((r) => (
            <li key={r.id} className="px-4 py-2">
              <div>
                <span className="mr-2 font-mono text-xs font-bold">{r.id}</span>
                <span className="font-semibold">{r.title}</span>
              </div>
              <div className="text-muted">{r.description}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="dir-h">
        <CardHeader
          id="dir-h"
          icon={<BookOpen className="h-4 w-4 text-brand" />}
          title="Trusted Assistance Directory"
          subtitle="A small Virginia-focused seed (shaped after the Open Referral HSDS model). Standing entries were compiled from each provider's published contacts and must be re-checked against the source before operational use; EXERCISE entries exist only in the fictional scenario and never appear in a live workspace."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">Service</th>
                <th className="px-4 py-2">Area</th>
                <th className="px-4 py-2">Eligibility</th>
                <th className="px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ASSISTANCE_DIRECTORY.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{d.name}</span> {d.simulated ? <Pill className="bg-trained-soft text-trained">EXERCISE</Pill> : null}
                    <div className="text-xs text-muted">{d.provider}</div>
                  </td>
                  <td className="px-4 py-2 text-muted">{d.geographyLabel}</td>
                  <td className="px-4 py-2 text-xs text-muted">{d.eligibility?.map((e) => e.description).join(" ") || "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {d.authoritativeSource}
                    <div>listed {d.lastVerifiedAt}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card aria-labelledby="hz-h">
        <CardHeader id="hz-h" icon={<X className="h-4 w-4 text-life" />} title="Hazard rules — these never generate civilian missions" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">Rule</th>
                <th className="px-4 py-2">Hazard</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2">Escalation recommended to</th>
                <th className="px-4 py-2">Resident guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {Object.values(HAZARD_RULES).map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs font-bold">{r.id}</td>
                  <td className="px-4 py-2 font-medium">{r.title}</td>
                  <td className="px-4 py-2">
                    <Pill className={r.level === "LIFE_SAFETY_EMERGENCY" ? "bg-life text-white" : "bg-pro text-white"}>{TRIAGE_LABELS[r.level].short}</Pill>
                  </td>
                  <td className="px-4 py-2 text-muted">{r.escalateTo.map((e) => ESCALATION_LABELS[e]).join(", ")}</td>
                  <td className="px-4 py-2 text-muted">{r.guidance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="pol-h">
          <CardHeader id="pol-h" icon={<ShieldCheck className="h-4 w-4 text-ink" />} title="Policy rules" />
          <ul className="divide-y divide-line text-sm">
            {POLICY_RULES.map((r) => (
              <li key={r.id} className="px-4 py-2">
                <div>
                  <span className="mr-2 font-mono text-xs font-bold">{r.id}</span>
                  <span className="font-semibold">{r.title}</span>
                </div>
                <div className="text-muted">{r.description}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="score-h">
          <CardHeader id="score-h" icon={<Bot className="h-4 w-4 text-brand" />} title="Match score (eligible candidates only)" subtitle="Weights sum to 100. Ties break by distance, then ID — fully deterministic." />
          <ul className="divide-y divide-line text-sm">
            {SCORE_WEIGHTS.map((w) => (
              <li key={w.key} className="flex gap-3 px-4 py-2">
                <span className="w-10 shrink-0 text-right font-mono font-bold text-brand">{w.max}</span>
                <span>
                  <span className="font-semibold">{w.label}</span> — <span className="text-muted">{w.how}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="cor-h">
          <CardHeader id="cor-h" icon={<Radio className="h-4 w-4 text-ink" />} title="When is an outside report acted on?" subtitle="Correlation rules — deterministic; AI may summarize, never decide." />
          <ul className="divide-y divide-line text-sm">
            {CORRELATION_RULES.map((r) => (
              <li key={r.id} className="px-4 py-2">
                <div>
                  <span className="mr-2 font-mono text-xs font-bold">{r.id}</span>
                  <span className="font-semibold">{r.title}</span>
                </div>
                <div className="text-muted">{r.description}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="rea-h">
          <CardHeader id="rea-h" icon={<ShieldCheck className="h-4 w-4 text-life" />} title="Missions in the field — reassessment rules" subtitle="Precedence: escalate > hold > reroute > continue. Routes are never called “safe”." />
          <ul className="divide-y divide-line text-sm">
            {REASSESSMENT_RULES.map((r) => (
              <li key={r.id} className="px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold">{r.id}</span>
                  <span className="font-semibold">{r.title}</span>
                  <Pill className={r.outcome === "ESCALATE" ? "bg-life text-white" : r.outcome === "HOLD" ? "bg-pro text-white" : r.outcome === "REROUTE" ? "bg-trained-soft text-trained" : "bg-done-soft text-done"}>{r.outcome}</Pill>
                </div>
                <div className="text-muted">{r.description}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card aria-labelledby="src-h">
        <CardHeader id="src-h" icon={<Database className="h-4 w-4 text-brand" />} title="Data sources" subtitle="Tier 1: public feeds usable now · Tier 2: require access or a partnership. Status on the operations dashboard comes from real fetch results." />
        <ul className="divide-y divide-line text-sm">
          {PROVIDERS.map((p) => (
            <li key={p.id} className="flex flex-wrap gap-x-3 px-4 py-2">
              <span className="w-14 shrink-0 font-mono text-xs font-bold text-muted">TIER {p.tier}</span>
              <span className="font-semibold text-ink">{p.name}</span>
              <span className="text-muted">{p.describes}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="az-h">
        <CardHeader id="az-h" icon={<Cloud className="h-4 w-4 text-brand" />} title="Microsoft Azure architecture" />
        <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <Sparkles className="h-5 w-5" />, name: "Azure AI Foundry", what: "Intake interpretation (optionally with photo), team briefings, situation reports." },
            { icon: <Database className="h-5 w-5" />, name: "Azure Cosmos DB", what: "Incidents, missions and responders; partitioned by operation / sandbox; serverless." },
            { icon: <Map className="h-5 w-5" />, name: "Azure Maps", what: "Tiles, geocoding, traffic incidents and traffic-aware routing with avoid-areas, through a server proxy." },
            { icon: <Cloud className="h-5 w-5" />, name: "Azure App Service", what: "Next.js standalone server; deployed by GitHub Actions." },
          ].map((s) => (
            <div key={s.name} className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <span className="text-brand">{s.icon}</span>
                {s.name}
              </div>
              <p className="mt-1 text-muted">{s.what}</p>
            </div>
          ))}
        </div>
        <p className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs text-muted">
          <Radio className="h-3.5 w-3.5" /> Every Azure service sits behind an adapter with a local fallback, so the full product can be demonstrated without credentials.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="real-h">
          <CardHeader id="real-h" icon={<Check className="h-4 w-4 text-done" />} title="Working in this prototype" />
          <ul className="space-y-1.5 p-4 text-sm">
            {REAL.map((r) => (
              <li key={r} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" /> {r}
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="sim-h">
          <CardHeader id="sim-h" icon={<Radio className="h-4 w-4 text-trained" />} title="Simulated in this prototype" />
          <ul className="space-y-1.5 p-4 text-sm">
            {SIMULATED.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-0.5 font-bold text-trained">SIM</span> {r}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="text-center">
        <Link href="/demo" className="inline-flex items-center gap-2 rounded-md bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark">
          Run the 3-minute guided demo <ArrowRight className="h-4 w-4" />
        </Link>
      </p>
    </div>
  );
}
