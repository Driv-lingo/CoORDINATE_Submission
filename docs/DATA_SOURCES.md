# Data sources

Every operational source is a read-only adapter in [`src/providers/`](../src/providers) that
normalizes its feed into `OperationalEvent`s (see [`src/domain/ops.ts`](../src/domain/ops.ts)).
Providers never write to any external system.

## Tiers

- **Tier 1 — public feeds usable now** (some need a free key or registration).
- **Tier 2 — access-dependent**: require a formal agreement. Adapters exist so the architecture
  has a place for them; they report `PARTNER_REQUIRED` and fetch nothing.
- **Tier 3 — simulated**: the exercise feeds used in every demo sandbox, all labelled `SIMULATED`.

| Source | Tier | Authority | What it contributes | Configuration |
| --- | --- | --- | --- | --- |
| National Weather Service active alerts (`api.weather.gov/alerts/active?area=VA`) | 1 | `AUTHORITATIVE_ALERT` | Tornado / severe thunderstorm / wind warnings (holds), flash-flood warnings (context), evacuation, shelter-in-place | No key. `NWS_USER_AGENT` (NWS asks for contact info), `NWS_AREA`, `NWS_ENABLED` |
| Azure Maps Traffic incidents | 1 | `AUTHORITATIVE_OPERATIONAL_DATA` | Crashes, closures (block), congestion and works (slow) inside the operation bbox | `AZURE_MAPS_KEY`, `AZURE_MAPS_TRAFFIC_API_VERSION` (default `1.0`), `COORDINATE_OPERATION_BBOX` |
| Azure Maps Route Directions | 1 | — | Traffic-aware travel time in live mode, with restrictions as avoid-rectangles; the route is re-checked against exact geometry | `AZURE_MAPS_KEY` |
| Virginia 511 / VDOT events (SmarterRoads) | 1 | `AUTHORITATIVE_OPERATIONAL_DATA` | Incidents, lane closures, work zones (WZDx v4 or GeoJSON); full closures block, partial ones slow | `VA511_FEED_URL`, `VA511_API_TOKEN`, optional `VA511_TOKEN_HEADER` |
| VDOT traffic cameras (SmarterRoads) | 1 | — (cameras produce observations) | Camera locations and HTTPS snapshot URLs; frames classified on request by Azure AI Foundry vision | `VDOT_CAMERA_FEED_URL`, `AZURE_AI_FOUNDRY_VISION=true` |
| Public CAD / active-calls feed | 1 | `AUTHORITATIVE_OPERATIONAL_DATA`, **advisory only** | Delayed public-safety activity for awareness | `PUBLIC_CAD_FEED_URL`, `PUBLIC_CAD_SOURCE_NAME`, `PUBLIC_CAD_DELAY_SECONDS` |
| Local news RSS | 1 | `MEDIA_REPORT`, always unverified | Closure / flooding headlines located by known place names | `NEWS_RSS_URLS` |
| Resident road reports (CoORDINATE intake) | 1 | `COMMUNITY_REPORT` | Information-only reports (rule R-I01); two named residents are two independent sources, anonymous reports count as one | built in |
| IPAWS (CAP 1.2) | 2 | `AUTHORITATIVE_ALERT` | Public warnings from alerting authorities | `IPAWS_CAP_FEED_URL` — requires FEMA IPAWS-OPEN authorization |
| Ring (owner opt-in) | 2 | `MACHINE_DERIVED_OBSERVATION` | Owner-consented, purpose-bound snapshots | Requires a Ring partnership; simulated device in the exercise |
| PulsePoint | 2 | — | Would provide delayed incident awareness | Requires an authorized agreement — **never scraped** |
| Agency CAD | 2 | — | Read-only awareness under a data-sharing agreement | No write access by design |
| Scenario feeds (TS Delphine) | 3 | as the source they imitate | NWS + IPAWS copies, VDOT closures and cameras, Azure Maps traffic, public CAD, a social post, a resident opt-in camera | built in; injections on `/ops` and in `/demo` |

## Trusted Assistance Directory

`src/data/assistanceDirectory.ts` — a small, Virginia-focused seed shaped after the Open
Referral Human Services Data Specification. Each entry has provider, service types, service
area (GeoJSON), eligibility rules, contact methods, `authoritativeSource` and `lastVerifiedAt`.

- **Standing services:** 911, FEMA Individual Assistance, SBA disaster loans, VDEM, 2-1-1
  Virginia, American Red Cross, the Disaster Distress Helpline, 988, 511 Virginia, NWS
  Blacksburg, Appalachian Power outages, Feeding Southwest Virginia, D-SNAP (Virginia DSS),
  Roanoke City / County emergency management. Only contacts the maintainers were confident of
  are listed; where a phone number was uncertain only the website is given. The sandbox could
  not reach these sites, so entries must be re-checked against their source before use.
- **Exercise activations** (simulated): an open shelter, a resource point, accessible rides and
  a casework desk for the fictional TS Delphine scenario — never shown in a live workspace.
- **Eligibility:** declaration-dependent programs are evaluated against the operation's
  declaration status (exercise: none yet; live: unknown → "check whether it applies").
- **Next step:** ingest 2-1-1 / HSDS feeds instead of the seed.

## Health states

The data-source panel on `/ops` shows each provider's state, **derived from what actually
happened** in this server process — never from configuration alone:

| State | Meaning |
| --- | --- |
| `LIVE` / `LIVE_DELAYED` | The last fetch succeeded within three poll intervals (`LIVE_DELAYED` for sources that are delayed by design, e.g. CAD, news) |
| `STALE` | Last success is older than three poll intervals |
| `DEGRADED` | The last fetch failed, but earlier data is still shown |
| `OFFLINE` | Every fetch so far has failed |
| `PENDING` | Configured, not polled yet (feeds are polled while a live view is open) |
| `NOT_CONFIGURED` | Missing URL/key — the reason and the setting to add are shown |
| `PARTNER_REQUIRED` | Needs a formal agreement |
| `SIMULATED` | Exercise data |
| `CONNECTED` | Azure services: the last call succeeded (or configured, no calls yet) |

Failed feeds back off to at least five minutes between attempts.

## Modes

Mode is chosen **per route/workspace**, never by one global switch:

- **Exercise (scenario)** — `/demo` and `/demo/*` run in a per-browser sandbox. Simulated events
  are stored with the workspace; the scenario provider never makes a network call, so the demo
  works with every external service down and live feeds can never affect fictional missions.
- **Live operation** — every other page uses the shared `live` workspace, served by the live
  provider: ingested feed items plus the operation's own real requests, reports and registered
  volunteers. Nothing fictional is seeded. If a source fails, the pages say so; they never
  substitute scenario data. `/live` shows each source's health and every item's provenance.
- **Incomplete picture** — when a configured live feed has not loaded or has failed, the
  picture is marked incomplete: dispatch shows a *sources* check naming the missing feeds, and
  reassessment may add holds but never clears one.

## Live mode (`/live`)

**Pipeline.** `source adapter → validation → normalization → deduplication → repository
(Cosmos DB) → Web PubSub → /live`.

- *Polling* — `src/instrumentation.ts` starts a server-side loop at start-up (every 15 s it
  polls the sources that are due; NWS every 60 s; failed sources back off to 5 minutes). Reading
  `/live` also triggers a due poll, as a fallback. `COORDINATE_LIVE_INGEST=false` disables the loop.
- *Normalization* (`liveEvent` in `src/providers/types.ts`) — every item gets provenance:
  `source` (provider id), `sourceId` (the upstream id), `sourceUrl`, `sourceUpdatedAt`,
  `ingestedAt`, `observedAt`, `expiresAt`, `rawHash` (sha256 of the upstream payload) and
  `status` (`active` / `cleared`). The raw payload is stored for audit (capped at 32 KB) and
  stripped before anything reaches a browser.
- *Validation and dedup* (`src/live/ingest.ts`) — items without provenance, simulated items and
  invalid geometry are rejected. Items are keyed by `source + sourceId`: a re-fetched item
  replaces its copy (upsert), an unchanged one is not rewritten, and an item the source stops
  listing is marked `cleared` (kept 24 h for audit), never deleted silently.
- *Storage* — the `live` partition of the existing Cosmos DB `ops` container (in memory without
  Cosmos). No new Azure resources.
- *Push* — when anything changes, a Web PubSub message goes to the `live` group; `/live`
  refreshes immediately (otherwise it polls every 30 s).

**Freshness.** Each source is shown as **healthy**, **degraded** (last fetch failed; older data
shown), **stale** (no success for 3 poll intervals), **offline** (never succeeded) or
**unavailable** (not configured / partner required). An item is *current* only when its source
is healthy and the item is not expired; otherwise it is labelled **STALE** with the source's
state. After a restart, stored items read as stale until the first successful poll.

**Sources.**

| Source | Setting | Notes |
| --- | --- | --- |
| NWS active alerts (`api.weather.gov/alerts/active?area=VA`) | `NWS_USER_AGENT` (contact e-mail, per NWS policy); `NWS_AREA` (default `VA`) | Authoritative weather alerts. IDs, timestamps, severity, geometry (zone geometry when the alert has no polygon) and the sender are preserved. |
| VDOT SmarterRoads events | `VA511_FEED_URL`, `VA511_API_TOKEN` | Unavailable until configured. 511 Virginia pages are never scraped. |
| VDOT cameras | `VDOT_CAMERA_FEED_URL` | Camera metadata only, kept separate from incidents. No imagery is scraped. |
| Public CAD | `PUBLIC_CAD_FEED_URL` | Official published feeds only; redaction respected; awareness only. |
| News | `NEWS_RSS_URLS` | Supplemental, unverified intelligence: shown separately, never an authoritative incident, never actionable alone. |

**Agents and safety.** The correlation engine and AI read only these normalized events. They
never invent source facts: titles, severities and times are shown as the source issued them,
and an unverified item (news, camera AI) cannot by itself become an authoritative incident or
trigger a safety-critical action. `/live` is awareness only: nothing on it dispatches anyone.

## Parsers and verification

Every parser is pure, tolerant of missing fields, skips a malformed item rather than failing
the whole feed, rejects invalid geometry, and is covered by fixture tests
([`providers.test.ts`](../src/engine/__tests__/providers.test.ts)): NWS (incl. zone geometry,
test/cancel/expired filtering), CAP 1.2 (lat,lon → lon,lat), Azure Maps traffic (v1 `tm.poi`
with expanded clusters, and GeoJSON), WZDx / generic 511, camera lists (HTTPS-only snapshots),
public CAD (redaction, advisory-only), news RSS (never actionable alone).

**Limitation, stated plainly:** the development sandbox blocks outbound calls to
`api.weather.gov`, `atlas.microsoft.com`, SmarterRoads and locality feeds, so the adapters
were verified against published formats with fixtures, not end-to-end. The UI reports the
resulting fetch errors honestly (`OFFLINE` / `DEGRADED`) rather than substituting data.

## Terms and privacy

- Use feeds only under their terms; CoORDINATE does not scrape.
- CAD and camera data are evidence and awareness, not authority over civilians.
- Withheld or redacted details are never reconstructed.
- No personal data from feeds is stored beyond the event itself; private-camera evidence
  expires after six hours and is deleted on revocation.
