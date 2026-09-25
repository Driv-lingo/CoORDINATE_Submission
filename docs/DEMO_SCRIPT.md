# Judge demo script (about 3 minutes)

Open **`/demo`** → **Start the demo**. Each visitor gets a private sandbox, so several judges
can run it at once. **Restart** resets it. A timer in the header tracks the 3-minute target;
the automated run takes about 30 seconds, and a narrated run takes about 3 minutes.

The demo proves both halves of the product: **navigation** (steps 1–2 and 8) and
**orchestration** (steps 3–7 and 9).

| # | Step | What to click | What to say (≈15–20 s each) |
| --- | --- | --- | --- |
| 1 | A resident asks for help | *Get guidance* (example pre-filled) | "Denise writes one message: a tree across the driveway, power out, her mother uses a wheelchair, nowhere to stay tonight, and a question about FEMA. Only the words and a rough location are required." |
| 2 | The navigator answers | Scroll, then *Request coordinated help* | "Azure AI Foundry splits that message into separate needs and quotes the words behind each one; the safety rules run first. **Immediate priority** comes before anything else. Then each need gets its own path: **a shelter coordinator** confirms an accessible placement; **Appalachian Power** for the outage; **FEMA** is shown with an honest condition — no federal declaration yet, so document the damage now. Every service shows its source. The tree and the blocked access *can* be handled by the community — **offered, not imposed**. Denise asks for it." |
| 3 | The requested need becomes a mission | *Form the team* | "Now the coordinator's view: needs → resolution paths, each with its rule. Only the two needs Denise requested became capability requirements. A chainsaw means credentialed roles; a wheelchair user at home means everyone on-site needs a background check." |
| 4 | The capability engine forms a team | *Review & dispatch* | "Marcus is 0.7 km away with a saw — but his chainsaw credential is *pending*: rejected. Jordan, 7.7 km, passes all nine gates. MSN-021: Jordan, Priya and Blue Ridge Landscaping with the truck and saw. Every choice lists its reasons." |
| 5 | Dispatch | *Dispatch MSN-021* | "The gate re-checks everything, **plans a route around known closures — 11 minutes via Rte 419** — and confirms no weather hold at the site. Only a coordinator can dispatch." |
| 6 | Live traffic closes the route | *Inject camera observation* → *Inject VDOT closure* | "A VDOT camera's AI flags an obstruction. **Nothing happens** — camera AI alone is never acted on. Then Virginia 511 reports a crash closing Rte 419: official, and corroborated. The team is **rerouted, 11 → 19 minutes**. We never call a route 'safe'." |
| 7 | Weather holds other missions | *Inject tornado warning* → *Try to resume* → *NWS: warning expires* → *Resume* | "A tornado warning across the river **holds three other missions**. Resume is **refused** while it is active; when it ends, a person resumes." |
| 8 | “There is a sparking power line.” | *Submit it* → *Draft summary* | "A second resident types one sentence. **Professional emergency response required. No community mission created.** The navigator prepares handoffs to the utility and 911 — *why*, *who*, *what* — and Foundry can draft the summary. CoORDINATE never contacts them; a person makes the call and records it." |
| 9 | The need is resolved | *Got it — following the new route* → *I'm on scene* → *Mark mission complete* → *Confirm as Denise* | "Jordan acknowledges the new route and finishes. Denise confirms; the community need becomes *resolved*." |
| 10 | Impact | — | "Needs by resolution path: many are handled by information, referral or a person — not every need becomes a dispatch. People helped, volunteer hours and donated value update." |

## Optional extras (30 seconds each)

- **Other navigator examples** on `/request`: *Flooded basement, father can't use stairs*
  (water removal offered; accessible transportation and shelter **suggested**, never assumed)
  and *Lost everything* (a caseworker handoff plus the Disaster Distress Helpline).
- **Guided-only incident:** INC-1043 — a family displaced by flooding got shelter and FEMA
  guidance, asked for no mission, and a coordinator later marked the shelter referral resolved.
- **Opt-in camera (step 5):** expand *Optional: confirm driveway access* → *Request one
  owner-authorized snapshot*. Purpose-bound, logged, revocable; kept 6 hours.
- **Operations dashboard:** `/ops` → the *Guided* tile, needs by resolution path, *Field ops*,
  *Conditions* (*Why?*), *Data sources* and the *Live Virginia* toggle.
- **How it works:** `/how-it-works` — navigator rules N-01…N-15 and the Trusted Assistance
  Directory with sources, rendered from the executing modules.
- **Public hazard map:** `/map` — official or corroborated conditions only; no people.

## Talking points by judging criterion (25% each)

- **Innovation** — Navigator → Orchestrator: need decomposition, a resolution path per need,
  eligibility-aware referrals with provenance, and — only where appropriate and requested —
  capability-matched teams that are re-planned as conditions change.
- **Performance** — guidance in seconds; request → dispatched team in minutes; every change
  re-checks every active mission in milliseconds.
- **Economic value & societal impact** — sends needs to existing programs first, mobilizes idle
  community capacity where they fall short, prioritizes the most vulnerable, and keeps
  volunteers out of harm's way.
- **Feasibility** — deterministic, unit-tested engine (145 tests); honest source tiers and
  simulation labels; human dispatch and escalation authority; Azure-native deployment.
