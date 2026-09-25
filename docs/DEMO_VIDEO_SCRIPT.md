# Demo video script — 3 minutes

**Goal:** prove both halves of the product in under 3:00. The first half shows **navigation** (the person gets a
trusted answer). The second half shows **orchestration** (a requested need becomes a safe, adaptive mission). It
ends with the power line, where the right answer is *no* mission.

**Voice-over:** about 430 words, at a calm 145 words per minute. Timings are targets; trim the "optional" lines
if you run long.

## Before recording

- Record the **deployed** app (production build) at 1440×900, browser zoom 110%, bookmarks bar hidden. The dev
  server's floating "N" badge does not appear in production.
- Configure Azure AI Foundry so the navigator shows **"Understood by Azure AI Foundry"** (and the handoff draft
  shows "drafted by Azure AI Foundry"). Without it, the app honestly says "local rules interpreter". Record
  only what the screen actually says.
- Open `/demo`, click **Start the demo** once, then **Restart** just before recording so the sandbox is fresh.
  Run the whole flow once to warm up Foundry and the map tiles.
- Have `/` (homepage) open in a second tab for the opening shot.
- Cursor highlight on, notifications off. Record in one take per scene; cut between scenes.

## Shot list

| Time | Scene / screen | On-screen action | Voice-over |
| --- | --- | --- | --- |
| 0:00–0:12 | **Homepage** hero | Slow push-in on the tagline; hover *GET HELP*. | "After a storm, people don't need another list of links. They need to know what to do — and sometimes, someone needs to actually show up. This is CoORDINATE: from chaos to coordinated action." |
| 0:12–0:25 | `/demo` step 1 — **resident request** | The example is pre-filled. Highlight the message, then click **Get guidance**. | "Denise writes one message: a tree across the driveway, the power's out, her mother uses a wheelchair, they have nowhere to stay tonight — and she asks about FEMA." |
| 0:25–0:55 | Step 2 — **navigator answer** | Hold on *We identified* and *Immediate priority*. Scroll slowly past the shelter card (pause on the source and date), the Appalachian Power card, and the FEMA card with its warning. | "Azure AI Foundry reads her words and pulls out each need, quoting what she said. Safety rules run first, so the immediate priority is at the top. Then every need gets its own path. An accessible place to stay goes to a shelter coordinator. The outage goes to the utility. FEMA is shown honestly: there's no federal declaration yet, so she should document the damage now. Every service shows where it comes from." |
| 0:55–1:05 | Step 2 — **request panel** | Show the two pre-checked items and click **Request coordinated help**. | "Clearing the tree and the driveway *can* be done by the community. It's offered, not imposed — Denise chooses to ask." |
| 1:05–1:20 | Step 3 — **needs → resolution paths** (coordinator) | Scroll the needs list, then the *Required capabilities* card. | "Now the coordinator's view. Only what Denise requested became requirements: a credentialed chainsaw operator, a helper, a saw and a truck — and, because a wheelchair user lives there, background checks for everyone on site." |
| 1:20–1:35 | Step 4 — **team** | Zoom on the *Proximity never overrides a missing credential* callout. | "The closest volunteer is rejected — his chainsaw credential is still pending. Jordan, farther away, passes all nine gates. Every choice explains itself." |
| 1:35–1:45 | Step 5 — **dispatch** | Click **Dispatch MSN-021**; hold on the route line "11 min". | "A human dispatches. The route avoids known closures: eleven minutes." |
| 1:45–2:10 | Step 6 — **reroute** | Click **Inject camera observation**, pause on "no change". Click **Inject VDOT closure**, then hold on "11 → 19 min" and the map. | "A traffic camera's AI flags an obstruction — and nothing happens, because an AI observation alone is never acted on. Then VDOT reports a crash closing Route 419. That's official. The team is rerouted automatically: nineteen minutes, around the closure." |
| 2:10–2:25 | Step 7 — **weather** | Click **Inject tornado warning**, then **Try to resume** (show "Refused"). | "A tornado warning holds three other missions. Nobody can override it; resume unlocks only when the warning ends." |
| 2:25–2:45 | Step 8 — **power line** | Click **Submit it**; hold on the red line. Click **Draft summary**, then open *What to hand off*. | "Another resident types one sentence: there's a sparking power line. Professional emergency response required — no community mission created. CoORDINATE prepares the handoff for the utility and 911: why, who, and what. A person makes the call." |
| 2:45–2:55 | Step 10 — **impact** | Skip step 9 in the edit, or speed it up 4×. Hold on *Needs by resolution path*. | "Denise confirms the job is done. Across the operation, many needs are handled without ever dispatching anyone — and the rest get a qualified, verified team." |
| 2:55–3:00 | **End card** | Tagline, demo URL and repository. | "CoORDINATE. Navigate the person. Resolve the need. Coordinate the response." |

## On-screen captions (optional, lower third)

1. "Azure AI Foundry understands · rules decide · people act"
2. "Every need → its own resolution path"
3. "Community help: offered, not imposed"
4. "Camera AI alone never changes a plan"
5. "Hazards → professionals only"
6. "Fictional exercise data — simulated feeds are labelled"

## Honesty checklist for the edit

- Keep the **"Fictional exercise"** banner visible in at least one shot, and never call simulated feeds live.
- Don't say "911 was contacted" or that a route is "safe". The product never says either.
- If Foundry was not configured when you recorded, don't say "Foundry"; say "the interpreter".
- Directory contacts are real public services; the shelter, resource point, rides and casework desk marked
  **EXERCISE** are fictional.
