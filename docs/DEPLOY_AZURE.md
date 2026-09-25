# Deploying CoORDINATE to Azure

Target: **Azure App Service (Linux, Node 22)** running the Next.js standalone
server, with **Azure AI Foundry**, **Azure Cosmos DB**, **Azure Maps** and
(optionally) **Azure Web PubSub**. GitHub holds the code; GitHub Actions
deploys it.

> Every Azure setting is optional. If a service is missing or failing, the app
> falls back to its local implementation, so a partially configured deployment
> still demos end to end.

## 1. Provision everything with Bicep (≈10 minutes)

```bash
az login
az group create -n rg-coordinate -l eastus2

az deployment group create \
  -g rg-coordinate \
  -f infra/main.bicep \
  -p namePrefix=coordinate
```

Outputs include `webAppName` and `webAppUrl`. The template creates:

| Resource | SKU | Notes |
| --- | --- | --- |
| App Service plan + Web App | B1 Linux, `NODE|22-lts` | start command `node server.js`; app settings wired to the resources below |
| Cosmos DB account | Serverless, NoSQL | database `coordinate`, containers `incidents` / `missions` / `responders` / `ops`, partition key `/workspaceId` |
| Azure Maps account | Gen2 (G2) | server-side only: tiles, geocoding, traffic incidents, traffic-aware routing |
| Azure AI Foundry (AI Services) + model deployment | S0, GlobalStandard | parameters `aiModelName` / `aiModelVersion` (default `gpt-4.1-mini` / `2025-04-14`) — pick a model available in your region |
| Azure Web PubSub | Free_F1 | live dashboard refresh; `deployWebPubSub=false` to skip |

Useful parameters:

```bash
# Use a model you already deployed in the Foundry portal instead of creating one
-p deployAiFoundry=false existingAiEndpoint=https://<res>.openai.azure.com \
   existingAiKey=<key> existingAiDeployment=<deployment-name>

# The live operation (every page except /demo): coordinator sign-in needs the passcode;
# sessionSecret signs sign-in cookies (defaults to a new random value per deployment,
# which signs everyone out on redeploy).
-p coordinatorPasscode=<passcode> sessionSecret=$(openssl rand -hex 32)

# Live Virginia feeds for /live (the exercise at /demo is unaffected)
-p nwsUserAgent="CoORDINATE (ops@example.org)" \
   va511FeedUrl=<SmarterRoads event feed URL> va511ApiToken=<token> \
   vdotCameraFeedUrl=<SmarterRoads camera list URL> \
   publicCadFeedUrl=<locality active-calls feed URL> newsRssUrls=<rss1,rss2>
```

NWS alerts need no key. Azure Maps traffic uses the Maps account the template creates. The
other feeds are optional; unconfigured ones show `NOT_CONFIGURED` on the data-source panel.
Set `aiVision=false` if your model deployment does not accept images.

If the model/version is not offered in your region, the deployment fails on
the `aiDeployment` resource: re-run with a different `aiModelName`/`aiModelVersion`,
or with `deployAiFoundry=false` and an existing endpoint.

## 2. Deploy the code with GitHub Actions

1. Web App → **Overview → Download publish profile**.
2. GitHub repo → **Settings → Secrets and variables → Actions**
   - Secret `AZURE_WEBAPP_PUBLISH_PROFILE` = contents of the publish profile
   - Variable `AZURE_WEBAPP_NAME` = the `webAppName` output
3. Push to `main` (or run **Deploy to Azure App Service** manually).

The workflow (`.github/workflows/azure-webapp.yml`) runs the unit tests,
builds, assembles `.next/standalone` + static assets with
`scripts/package-standalone.mjs`, and deploys with `azure/webapps-deploy@v3`.

The Bicep template enables SCM basic-auth publishing so the publish profile
works. For production, switch to OpenID Connect: create a federated credential
for the repo, replace the `publish-profile` input with an `azure/login@v2`
step, and set `scmPublishing.allow` to `false`.

## 3. Manual deploy (no GitHub Actions)

```bash
npm ci && npm run build && npm run package:azure   # creates ./deploy and deploy.zip
az webapp deploy -g rg-coordinate -n <webAppName> --src-path deploy.zip --type zip
```

## 4. Configure an existing Web App by hand

If you created resources in the portal instead of Bicep, set these app
settings (see `.env.example` for descriptions):

```
SCM_DO_BUILD_DURING_DEPLOYMENT=false
HOSTNAME=0.0.0.0
AZURE_AI_FOUNDRY_ENDPOINT=https://<resource>.openai.azure.com
AZURE_AI_FOUNDRY_API_KEY=<key>
AZURE_AI_FOUNDRY_DEPLOYMENT=<deployment-name>
COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/
COSMOS_KEY=<primary key>
AZURE_MAPS_KEY=<primary key>
AZURE_WEB_PUBSUB_CONNECTION_STRING=<connection string>   # optional
AZURE_AI_FOUNDRY_VISION=true                               # optional: model accepts images
NWS_USER_AGENT=CoORDINATE (ops@example.org)                # optional live feeds…
VA511_FEED_URL= / VA511_API_TOKEN= / VDOT_CAMERA_FEED_URL=
PUBLIC_CAD_FEED_URL= / NEWS_RSS_URLS=
COORDINATE_LIVE_INGEST=true                                # server-side polling for /live
COORDINATE_SESSION_SECRET=<random hex>                      # live operation: signs sign-in cookies
COORDINATE_COORDINATOR_PASSCODE=<passcode>                 # live operation: coordinator sign-in
```

and the startup command `node server.js` (Configuration → General settings).
Cosmos DB containers are created automatically on first request if they don't
exist.

## 5. Verify

- Open `https://<webAppName>.azurewebsites.net` — the status bar under the
  header shows which providers are live (AI Foundry / Cosmos DB / Azure Maps /
  Web PubSub). Grey dots mean a fallback is active.
- Run `/demo`. The interpretation card shows `Azure AI Foundry · <model>`; if
  Foundry failed, it shows the fallback reason.
- `GET /api/system` returns the same provider status as JSON.
- `/ops` → *Data sources*: every Azure service and feed with a state derived from real
  call results.
- `/live`: NWS should show **Healthy** within a minute if outbound access to `api.weather.gov`
  is allowed, with the last-updated time and any active Virginia alerts.

## Escape hatch: Vercel for the frontend

If App Service costs you hackathon hours, deploy the same repository to Vercel
(it detects Next.js automatically) and set the same environment variables.
Foundry, Cosmos DB, Maps and Web PubSub stay on Azure. Note: the in-memory
store does not persist across Vercel serverless instances — configure Cosmos DB
when using Vercel.

## Production hardening (beyond the prototype)

- Managed identity + Key Vault references instead of keys in app settings
  (Cosmos DB data-plane RBAC, Azure Maps Entra auth, Foundry Entra auth).
- Microsoft Entra External ID for residents and volunteers; Entra ID for
  coordinators, with role claims replacing personas.
- Private endpoints for Cosmos DB and Foundry; Azure Front Door + WAF.
- Application Insights for tracing AI latency, fallbacks and dispatch-gate failures.
- Real integrations under agreements: read-only CAD awareness via the jurisdiction's ECC,
  IPAWS-OPEN, utility outage APIs, background-check and credential registries, SMS via Azure
  Communication Services. CoORDINATE should never gain write access to CAD or 911 systems.
- Scale-out: Cosmos DB optimistic concurrency (ETags) in place of the per-instance workspace
  lock; a timer-triggered reassessment (e.g. Azure Functions) in addition to read-triggered.
