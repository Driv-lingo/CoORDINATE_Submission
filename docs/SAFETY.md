# Safety model and assumptions

CoORDINATE's core commitment: **AI never makes a safety-critical decision.** The model
interprets language and images. Deterministic, unit-tested code decides whether civilians
may respond, who is eligible, which outside reports are actionable, and when a mission must
hold or reroute. Humans dispatch, resume and verify.

## Navigator: every need gets a safe path

Not every need should become a volunteer mission. Navigator rules (`src/engine/navigator.ts`,
rendered on `/how-it-works`) decide each need's path:

- **N-01 / N-02** — immediate danger and hazards create *professional response* needs only.
- **N-03** — while a hazard at the site is active, every community need is *blocked*; a
  sparking power line produces **"Professional emergency response required. No community
  mission created."**
- **N-05** — food, water and charging go to distribution points unless the household cannot
  travel; only then is a delivery a community mission.
- **N-07 / N-10 / N-11 / N-13** — shelter with access needs, complex recovery, crisis words and
  unclear requests go to **people** (shelter coordinator, caseworker, a coordinator call-back;
  988 first for crisis), never to volunteers.
- **N-09** — programs that depend on a declaration say so; the navigator never implies
  eligibility it can't check.
- **N-14 / N-15** — suggestions are offered, never assumed, and nothing is staffed until the
  resident (or a coordinator on their behalf) requests coordinated help for specific needs.

**Handoffs are not contact.** Each escalation carries *why* (rule), *who* (destination class
and a suggested contact from the directory) and *what* (a summary). Summaries end with "no
agency or person has been contacted by the system"; Foundry drafts must pass the wording
policy. Summaries are shown to coordinators only.

**Directory honesty.** Standing entries were compiled from providers' published contacts and
dated; the development environment could not reach the source sites, so each must be
re-checked before operational use. Exercise-only activations are labelled EXERCISE and never
appear in a live workspace.

## Defense in depth — requests and teams

1. **Untrusted AI output.** The Foundry response is parsed field by field. Unknown codes are
   dropped, numbers clamped, strings truncated; a malformed field never discards the others.
2. **Independent hazard scanner.** A conservative keyword scanner runs on every request; its
   hazards are unioned with the AI's. The AI can add hazards, never remove one (unit-tested).
3. **Resident answers win.** "Someone is in immediate danger" always escalates.
4. **Negation needs a human.** "No power lines are down" creates advisory R-A01 that blocks
   dispatch until a coordinator confirms with the resident.
5. **No AI de-escalation.** Only the scanner or the resident can mark a report *information
   only* (R-I01); any hazard in such a report still escalates.
6. **Duplicates are flagged, never merged** (R-A04): a request within 150 m and 12 hours of an
   open incident with the same need raises an advisory that blocks dispatch until a
   coordinator checks — so two teams are not sent to one job, and no report is silently dropped.
7. **Hard gates before scoring** (R-M01). Proximity cannot compensate for a failed gate.
8. **Dispatch re-validation** (R-D01): triage re-run, every assignment re-checked, a route
   must exist within the usable network (D-ROUTE), and no weather or safety hold may cover
   the site (D-CONDITIONS).
9. **Human authority** (R-D02): only a coordinator dispatches or resumes; only the
   coordinator or resident verifies; volunteers update only their own missions.
10. **Audit trail.** Every AI proposal, validation correction, rule decision, reroute, hold,
   route acknowledgement, resume, recorded escalation and camera access is logged.

## Response classes

| Class | Meaning |
| --- | --- |
| Emergency escalation | Immediate threat to life. The resident is told to call 911; professional escalation is recommended. No civilian mission. |
| Professional response required | A hazard needs a utility, public-safety or building authority. No civilian mission until the authority clears it (R-C01). |
| Specialized volunteer eligible | A role needs a state license (e.g. licensed electrician for a generator hookup, R-T02). |
| Trained volunteer eligible | A role needs a verified external credential (R-T01). |
| General volunteer eligible | Identity-verified community volunteers may help. |
| Information only | A road/area report with no help requested (R-I01): an unverified community report, no mission. |

## Hazards that never produce civilian missions

| Rule | Hazard | Class | Escalation recommended to |
| --- | --- | --- | --- |
| R-H01 | Active fire | Emergency | Fire & Rescue via 911 |
| R-H02 | Violence or threat | Emergency | Law enforcement via 911 |
| R-H03 | Suspected gas leak | Professional | Gas utility, Fire & Rescue |
| R-H04 | Downed electrical line | Professional | Electric utility, Fire & Rescue |
| R-H05 | Unstable structure | Professional | Building official, Fire & Rescue |
| R-H06 | Hazardous materials | Professional | HazMat via emergency management, Fire & Rescue |
| R-H07 | Swift / flood water rescue | Emergency | Swift-water rescue via 911 |
| R-H08 | Medical emergency | Emergency | EMS via 911 |

**Escalation honesty.** CoORDINATE has **no connection** to 911, CAD or any utility. It never
displays "911 contacted". The rules produce a *recommendation*; a coordinator makes the call
through normal channels and records "contact made" and, later, the agency's acknowledgement.
The resident is always told to call 911 themselves if anyone is in danger.

## Operational picture: when is an outside report acted on?

| Rule | |
| --- | --- |
| **A1** | An official source acts alone: an authoritative alert (NWS, IPAWS), authoritative operational data (VDOT / 511, Azure Maps Traffic), a verified partner, or a coordinator confirmation. |
| **A2** | Otherwise it needs corroboration: two independent current sources **proposing the same effect** (a closure is corroborated by another closure report, not by congestion), at least one a community report or better. Two named residents are two sources; anonymous reports count as one source together; two items from one feed are one. |
| **A3** | News, social posts and camera-AI observations **never act alone** — they create a review item, not an operational change. An item a coordinator marks *disputed* is excluded from corroboration. |
| **A4** | Expired items are dropped; stale items are shown greyed out and never acted on. Observations (resident reports, news, camera frames) age from when they were made; feed conditions (closures, work zones) stay current while the feed still lists them. |

**Effects apply where they were reported.** Each actionable effect is placed on the geometry of
the source that proposed it — a closure reported on a line is not moved to a nearby
congestion point, and a site inside the second of two merged warning polygons is still held.

Public CAD is **awareness only**: every CAD item is `ADVISORY` and can never route or hold a
volunteer. Where a source withholds details, CoORDINATE shows "details withheld" and never
geocodes or reconstructs them.

## Missions in the field

| Rule | Condition | Outcome |
| --- | --- | --- |
| W-01 | Tornado warning (or shelter-in-place) over the site or remaining route | HOLD — on scene: shelter; mobilizing: do not travel |
| W-02 | Severe thunderstorm / high wind over outdoor work (saws, ladders, roofs, debris) | HOLD outdoor work |
| S-01 | Fire, hazmat or evacuation area covers the site | ESCALATE — leave; professional follow-up |
| R-01 | Actionable closure or avoid-area on the remaining route | REROUTE within the usable network; team acknowledges |
| R-02 | No route avoids the known restrictions | HOLD — never "route anyway" |
| H-01 | The condition behind a hold ended | Mark cleared; a coordinator resumes |

- A cleared hold is **reinstated** if the condition returns before anyone resumes, and a hold is
  **upgraded** to S-01 (with a recommended escalation) if an evacuation or fire area reaches the site.
- An R-02 (no route) hold clears only when a route exists; the new route is attached and the
  team must acknowledge it.
- A closure **at the job site itself** does not block the route — the blockage is usually the job.
- In a live workspace, if any configured feed is unavailable the picture is marked incomplete:
  dispatch shows a *sources* warning, travel times are labelled estimates, and **holds are never
  cleared automatically** until the picture is complete again.

Precedence: escalate > hold > reroute > continue. Holds on households that depend on medical
equipment or include people who cannot shelter unaided carry a **welfare note** prompting the
coordinator to call them and escalate to EMS if a device fails.

**Wording.** Routes are never called "safe". The system says "No known blocking condition was
detected on this route from the currently available data" or "This route avoids currently
known closures and operational restrictions." A straight-line estimate (outside road-graph
coverage) is labelled as such and refused if it crosses a restriction.

## Cameras: evidence, not surveillance

- **No** facial recognition, biometrics, person tracking, licence-plate lookup or
  neighborhood activity histories. The Foundry camera prompt forbids describing people or
  plates and classifies the roadway only.
- Camera observations are `MACHINE_DERIVED_OBSERVATION` and **never act alone** (A3); a
  coordinator can confirm after looking.
- Public cameras: a single current frame on request; each view is logged.
- Private cameras (Ring-style, **simulated** in this prototype — there is no Ring API
  connection): explicit owner consent with scope (`CURRENT_SNAPSHOT`), purpose and expiry;
  a snapshot may be requested only for an open incident within 400 m of the camera; every
  access is logged; the owner can revoke at any time, which blocks access and deletes stored
  snapshot references; observations expire after 6 hours; no live view or continuous recording.
- Private cameras never appear on the public map or to other volunteers; their clusters and
  evidence are visible to coordinators only.

**Who sees what.** Coordinators see everything. An assigned team sees its own route. Everyone
else sees the incident without the route origin, path, evidence or opt-in cameras.

## Public hazard map

Only official or corroborated conditions (plus official advisory warnings). Never people,
volunteer locations, requests, missions, private cameras or resident wording (community-only
clusters get a generic title such as "Reported road obstruction (corroborated)").

## Credential policy

- CoORDINATE records and verifies external credentials; it never issues certifications.
- Only `VERIFIED` and unexpired credentials count; `PENDING` never does.
- Internal training modules award badges; a badge never substitutes for a credential.
- Vulnerable-occupant rule (R-V01): everyone going on-site needs a verified background check.
- Specialist roles: chainsaw (chainsaw safety), roofs (fall protection, two people), accessible
  transport (wheelchair securement), wellness checks (two people, one with First Aid/CPR),
  generator hookup (licensed electrician, generator CO-safety module).

## Assumptions and limits

- **No emergency-services integration**; escalations are recommendations recorded by people.
- **Not NIMS/ICS compliant, FEMA certified or government approved**, and not claimed to be.
- **Personas, not authentication** (Microsoft Entra ID / External ID in production). In a
  shared workspace the persona cookie is HMAC-signed (`COORDINATE_SESSION_SECRET`), visitors
  start as residents, and becoming coordinator needs `COORDINATE_COORDINATOR_PASSCODE`. Without
  a secret, every shared-mode visitor is treated as a resident.
- **Scanner coverage** is English-only and conservative; false positives cost a review.
- **Approximate locations** only; production would restrict precise addresses to the team.
- **Routing** uses a simplified scenario road graph in the exercise; re-plans start from the
  team's staging point (no live GPS). Azure Maps is used for travel time in live mode and its
  route is re-checked against exact restriction geometry.
- **Live feeds** are read-only and were validated against published formats with fixtures —
  the development sandbox could not reach them.
- **Scenario data** (storm, people, organizations, requests, conditions) is fictional.

## Responsible-AI notes for judges

- *Prompt injection:* resident text is delimited and labelled untrusted; more importantly,
  model output has no path to dispatch, holds or reroutes except through deterministic code.
- *Availability:* if Foundry fails, local fallbacks run and the reason is shown.
- *Wording policy:* generated briefings and SITREPs are checked for forbidden claims (a route
  called "safe", "911 contacted", "we notified the utility", certification claims). A draft that
  fails is discarded and the deterministic template is used instead.
- *Transparency:* every rule table on "How it works" is rendered from the executed modules;
  every match, hold and reroute carries its evidence ("Why?").
