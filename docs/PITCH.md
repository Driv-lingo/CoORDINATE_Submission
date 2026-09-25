# CoORDINATE — one-page pitch

**CoORDINATE — From chaos to coordinated action.**

CoORDINATE combines real-time disaster conditions, community needs, and available capabilities
to turn requests for help into safe, coordinated response missions.

## Problem

After a severe storm, people don't know what to do first, which programs apply to them, or
who can actually help — and a single message ("the basement is flooding and my father can't
use the stairs") hides several different needs. Most assistance navigators stop at a list of
resources. Meanwhile neighbors with trucks and chainsaws, CERT volunteers, shelters, pantries
and local businesses are ready to help but uncoordinated, and conditions on the ground change
by the minute.

## Solution: Navigator → Orchestrator

```
Navigate the person  →  Resolve the need  →  Coordinate the response
```

1. **Understand.** Azure AI Foundry reads the person's own words and extracts every need,
   quoting the words that support each one. Deterministic validation discards anything the
   words don't support.
2. **Safety first.** A rule engine checks eight hazard classes and immediate danger before
   anything else, and the resident sees an *immediate priority* block.
3. **Resolve each need.** Navigator rules give every need a resolution path — *information,
   service referral, human escalation, professional response, community mission, resource
   transfer* or *situational awareness* — with trusted services from a sourced Virginia
   directory and eligibility stated honestly (e.g. FEMA only after a federal declaration).
4. **Escalate to people, not just 911.** Handoffs to utilities, shelter coordinators,
   caseworkers or community coordinators explain **why**, **who** and **what** to hand off.
   CoORDINATE prepares them; a person makes the contact.
5. **Offer community help — only where appropriate, only if requested.** The resident chooses
   which needs to request. Those become capability requirements; every person and asset
   passes nine hard gates; a coordinator dispatches.
6. **Keep it safe as conditions change.** A common operational picture (NWS, Azure Maps
   traffic, VDOT 511 and cameras, public CAD, news, resident reports) re-checks every active
   mission: reroute around a new closure, hold under a tornado warning — with "Why?" records.

## Why it's different

A traditional assistance navigator: **Need → information / resource recommendation.**

CoORDINATE: **Need → trusted guidance → the right resolution path → referral / human
escalation / professional response / capability-matched community action → continuous
operational reassessment.**

- Not every need becomes a dispatch — and a sparking power line never does.
- Responsible AI by architecture: Foundry understands and drafts; rules decide; people act.
  AI can escalate, never de-escalate; camera AI and news never act alone.
- Honest by design: no "911 contacted", no "safe route", no simulated feed labelled live,
  every service shows its source and date.

## Impact

- Clear next steps for residents in seconds, in plain language.
- Needs go to existing programs first; idle community capacity fills the gaps.
- Prioritizes the most vulnerable (medical dependency, mobility, isolation, language access).
- Keeps volunteers out of harm's way; reduces coordinator workload.

## Feasibility

- Working prototype: Next.js + TypeScript; 145 unit tests (navigator, safety engine,
  correlation, routing, reassessment, provider parsers).
- Azure-native: AI Foundry (need extraction, drafting, vision), Azure Maps, Cosmos DB, Web
  PubSub, App Service — one Bicep template, GitHub Actions deployment. Runs fully without Azure.
- Path to production: 2-1-1 / Open Referral (HSDS) directory ingestion, Entra ID, real
  credential registries, SmarterRoads feeds, data-sharing agreements, SMS via Azure
  Communication Services.

## Demo

`/demo` — 10 steps in about three minutes, no account required. See
[DEMO_SCRIPT.md](DEMO_SCRIPT.md).
