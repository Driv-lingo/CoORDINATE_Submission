# Go live: GitHub → Azure, step by step

This checklist takes the repository to a **private, password-protected** site on Azure. It needs no local installs: everything runs in the
browser (GitHub and the Azure portal's Cloud Shell). Allow about an hour, most of it waiting.

You need:
- an Azure subscription where you are **Owner** or **Contributor**;
- **admin** rights on the GitHub repository `Driv-lingo/CoORDINATE`.

The result: a Web App at `https://<name>.azurewebsites.net` running CoORDINATE with Azure AI Foundry, Cosmos DB,
Azure Maps and Web PubSub. Every push to `main` redeploys it.

---

## Step 1 — Make `main` the default branch (GitHub, 1 min)

`main` exists and holds all the work. GitHub → **Settings → General → Default branch** → switch to `main`. You can
delete `claude/admiring-knuth-0y4hu0` afterwards.

> Every push to `main` runs **CI** and **Deploy to Azure App Service**. Until Step 5 is done, the deploy job is
> skipped (it only runs once the `AZURE_WEBAPP_NAME` variable exists).

## Step 2 — Open Azure Cloud Shell (Azure portal, 2 min)

1. Sign in to <https://portal.azure.com> with the account that owns the subscription.
2. Click the **Cloud Shell** icon (`>_`) in the top bar → **Bash**. If it asks, create the storage it offers.
3. Choose the right subscription:
   ```bash
   az account list -o table
   az account set --subscription "<subscription name or id>"
   ```
4. Get the template. Public repo: `git clone https://github.com/Driv-lingo/CoORDINATE.git && cd CoORDINATE`.
   Private repo: use Cloud Shell's **Upload** button to upload `infra/main.bicep`, then run
   `mkdir -p infra && mv main.bicep infra/`.

## Step 3 — Register the Azure services once (2 min)

New subscriptions often haven't enabled these resource providers yet:

```bash
for ns in Microsoft.Web Microsoft.DocumentDB Microsoft.Maps Microsoft.CognitiveServices Microsoft.SignalRService; do
  az provider register --namespace $ns
done
```

## Step 4 — Create everything with one template (10–15 min)

Choose a region that offers the `gpt-4.1-mini` model. East US 2 or Sweden Central usually do.

```bash
az group create -n rg-coordinate -l eastus2

az deployment group create \
  -g rg-coordinate \
  -f infra/main.bicep \
  -p namePrefix=coordinate \
     nwsUserAgent="CoORDINATE (your-email@example.org)" \
     accessPassword="<choose a password to share with judges>" \
     coordinatorPasscode="<a separate passcode for coordinators>" \
     sessionSecret="$(openssl rand -hex 32)"
```

`coordinatorPasscode` protects the coordinator role in the live operation (every page except `/demo`); without
it, anyone who can open the site can act as coordinator. A fixed `sessionSecret` keeps people signed in across
redeploys.

`accessPassword` keeps the site private: every page asks for it (browsers show a sign-in box; any user name
works). Share it only with your team and the judges. To change it later:
`az webapp config appsettings set -g rg-coordinate -n <webAppName> --settings COORDINATE_ACCESS_PASSWORD="<new>"`.

This creates the App Service plan (B1) and Web App, Cosmos DB (serverless), Azure Maps, Azure AI Foundry with a
`gpt-4.1-mini` deployment, and Web PubSub (free tier). It writes every key into the Web App's settings, so no
secrets go into GitHub.

**Two modes, by route.** `/demo` (and `/demo/ops`, `/demo/map`, …) is each browser's private copy of the fictional
exercise. Every other page is the one shared **live operation**: real requests, real registered volunteers, and real
Virginia feeds on every map. Nothing fictional is ever added to the live operation.

Then read the outputs:

```bash
az deployment group show -g rg-coordinate -n main --query properties.outputs -o jsonc
```

Note **`webAppName`** (e.g. `coordinateab12cd-web`) and **`webAppUrl`**.

**If it fails on the model deployment** (the model isn't available in the region, or there's no quota), either re-run
in another region, or request quota in the Foundry portal, or deploy without it and connect a model you already have:

```bash
az deployment group create -g rg-coordinate -f infra/main.bicep \
  -p namePrefix=coordinate deployAiFoundry=false \
     existingAiEndpoint=https://<resource>.openai.azure.com existingAiKey=<key> existingAiDeployment=<deployment>
```

## Step 5 — Connect GitHub to the Web App (5 min)

1. Download the publish profile in Cloud Shell:
   ```bash
   az webapp deployment list-publishing-profiles -g rg-coordinate -n <webAppName> --xml
   ```
   Copy the whole XML output. It is a credential: don't paste it anywhere else.
2. In GitHub → **Settings → Secrets and variables → Actions**:
   - **Secrets** tab → **New repository secret** → name `AZURE_WEBAPP_PUBLISH_PROFILE`, value = the XML.
   - **Variables** tab → **New repository variable** → name `AZURE_WEBAPP_NAME`, value = `<webAppName>`.

## Step 6 — Deploy (5–8 min)

GitHub → **Actions** → **Deploy to Azure App Service** → **Run workflow** → branch `main` → **Run**.

The job installs dependencies, runs the tests, builds, packages the standalone server and deploys it. From now
on, every push to `main` deploys automatically.

## Step 7 — Verify (5 min)

1. Open `webAppUrl`. The first request after a deploy can take up to a minute while the app starts.
2. The status bar under the header should show **Azure AI Foundry · Cosmos DB · Azure Maps · Web PubSub**. A grey item
   means that service is on its fallback (check its app setting; `/api/system` shows which provider is active).
3. Open `/demo` → **Start the demo** → **Get guidance**. The answer should say **"Understood by Azure AI Foundry"**.
   On the power-line step, **Draft summary** should say **"drafted by Azure AI Foundry"**.
4. Open `/live`: within a minute, **National Weather Service alerts** should show **Healthy** and list any active
   Virginia alerts (the list can be empty on a quiet day). Feeds you didn't configure show **Unavailable**, which
   is correct.

If something is wrong: `az webapp log tail -g rg-coordinate -n <webAppName>`.

## Step 8 — Optional: live Virginia data

The judge demo (`/demo`) runs on the fictional exercise. `/live` shows real feeds:

- **NWS alerts:** already on (Step 4 set the User-Agent).
- **Azure Maps traffic:** already on (it uses the Maps account).
- **VDOT 511 and traffic cameras:** register for free at SmarterRoads (VDOT), then:
  ```bash
  az webapp config appsettings set -g rg-coordinate -n <webAppName> --settings \
    VA511_FEED_URL="<event feed URL>" VA511_API_TOKEN="<token>" VDOT_CAMERA_FEED_URL="<camera list URL>"
  ```
- **News RSS:** `NEWS_RSS_URLS="https://…,https://…"` (local outlets).

Live items are stored in the existing Cosmos DB account and pushed over the existing Web PubSub: no new
resources.

## Step 9 — Run the live operation

1. **Volunteers** register on **Offer help** (name, starting location, travel radius, skills, equipment). Profiles
   start unverified.
2. **Coordinator**: choose *Coordinator* in the header and enter the passcode. On **Resources**, click
   **Verify identity** once you have checked the person (e.g. photo ID). On **Preparedness**, verify uploaded
   credential records. Only then can the matching gates select the volunteer.
3. **Residents** use **Get help**. Their requests appear on **Operations** with real hazards (NWS; VDOT when
   configured) on the map. Official warnings and closures hold and reroute missions; unverified reports never act
   alone.

To start the live operation over (e.g. after testing), delete the `live` partition's documents in Cosmos DB
(Data Explorer → each container → filter `c.workspaceId = "live"`).

## Costs and teardown

The B1 App Service plan is the main fixed cost, roughly $13–15 a month. Cosmos DB (serverless), Maps and Foundry
are pay-per-use and small at demo volume, and Web PubSub is on the free tier. To remove everything:

```bash
az group delete -n rg-coordinate --yes
```

## Before a real deployment

- Switch GitHub → Azure from the publish profile to OpenID Connect (`docs/DEPLOY_AZURE.md`, section 2).
- Move keys into Key Vault references with managed identity.
- Re-check every Trusted Assistance Directory entry against its source.
