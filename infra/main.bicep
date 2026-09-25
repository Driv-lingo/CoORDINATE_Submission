// CoORDINATE — Azure infrastructure
//
// Deploys: App Service (Linux, Node 22) + Azure Cosmos DB (serverless, NoSQL) + Azure Maps (Gen2)
//          + optional Azure AI Foundry resource with a chat model deployment + optional Azure Web PubSub.
// Live Virginia feeds (NWS works with no key; VDOT, CAD and news need URLs) are optional parameters.
//
//   az group create -n rg-coordinate -l eastus2
//   az deployment group create -g rg-coordinate -f infra/main.bicep -p namePrefix=coordinate
//
// Every service is optional at runtime: the app falls back to local implementations when a setting is absent.

@description('Short lowercase prefix for resource names (letters and digits).')
@minLength(3)
@maxLength(12)
param namePrefix string = 'coordinate'

@description('Region for all resources.')
param location string = resourceGroup().location

@description('App Service plan SKU. B1 is enough for the hackathon demo.')
param appServiceSku string = 'B1'

@description('Deploy an Azure AI Foundry (AI Services) resource and a chat model deployment.')
param deployAiFoundry bool = true

@description('Chat model to deploy. Pick a model/version available in your region and subscription.')
param aiModelName string = 'gpt-4.1-mini'

@description('Model version for the deployment.')
param aiModelVersion string = '2025-04-14'

@description('Deployment capacity (thousands of tokens per minute).')
param aiModelCapacity int = 20

@description('Use an existing Foundry / Azure OpenAI endpoint instead of deploying one (leave blank to use the deployed resource).')
param existingAiEndpoint string = ''

@secure()
@description('API key for existingAiEndpoint.')
param existingAiKey string = ''

@description('Deployment name on existingAiEndpoint.')
param existingAiDeployment string = ''

@description('Deploy Azure Web PubSub (Free tier) for instant dashboard updates. Without it the app polls every 5 s.')
param deployWebPubSub bool = true

@description('The deployed chat model accepts images (camera-frame classification, intake photos). gpt-4.1-mini does.')
param aiVision bool = true

@description('User-Agent for api.weather.gov (NWS asks for a contact, e.g. "CoORDINATE (ops@example.org)").')
param nwsUserAgent string = 'CoORDINATE community-coordination prototype'

@description('Optional: Virginia 511 / VDOT SmarterRoads event feed URL (GeoJSON or WZDx).')
param va511FeedUrl string = ''

@secure()
@description('Optional: SmarterRoads token for the VDOT feeds.')
param va511ApiToken string = ''

@description('Optional: VDOT traffic-camera list URL (SmarterRoads).')
param vdotCameraFeedUrl string = ''

@description('Optional: a locality\'s published active-calls (public CAD) feed URL, where its terms permit reuse.')
param publicCadFeedUrl string = ''

@description('Optional: comma-separated local news RSS feed URLs.')
param newsRssUrls string = ''

@secure()
@description('Signs sign-in cookies for the live operation. The default is a fresh random value on each deployment (users are signed out on redeploy); pass a fixed secret to keep sessions.')
param sessionSecret string = newGuid()

@secure()
@description('Private preview: every visitor must enter this password (any user name). Leave empty only if the site may be public.')
param accessPassword string = ''

@secure()
@description('Live operation: passcode required to act as coordinator (strongly recommended). Empty = anyone who can open the site can act as coordinator.')
param coordinatorPasscode string = ''

var suffix = uniqueString(resourceGroup().id)
var base = toLower('${namePrefix}${take(suffix, 6)}')

// ---------------------------------------------------------------- Cosmos DB
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: '${base}-cosmos'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    minimalTlsVersion: 'Tls12'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: 'coordinate'
  properties: {
    resource: {
      id: 'coordinate'
    }
  }
}

resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for c in ['incidents', 'missions', 'responders', 'ops']: {
    parent: cosmosDb
    name: c
    properties: {
      resource: {
        id: c
        partitionKey: {
          paths: [
            '/workspaceId'
          ]
          kind: 'Hash'
        }
        defaultTtl: -1
      }
    }
  }
]

// ---------------------------------------------------------------- Azure Maps
resource maps 'Microsoft.Maps/accounts@2023-06-01' = {
  name: '${base}-maps'
  location: 'global'
  sku: {
    name: 'G2'
  }
  kind: 'Gen2'
  properties: {
    disableLocalAuth: false
  }
}

// ---------------------------------------------------------------- Azure AI Foundry
resource ai 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (deployAiFoundry) {
  name: '${base}-ai'
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${base}-ai'
    publicNetworkAccess: 'Enabled'
  }
}

resource aiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (deployAiFoundry) {
  parent: ai
  name: aiModelName
  sku: {
    name: 'GlobalStandard'
    capacity: aiModelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: aiModelName
      version: aiModelVersion
    }
  }
}

var aiEndpoint = !empty(existingAiEndpoint) ? existingAiEndpoint : (deployAiFoundry ? 'https://${base}-ai.openai.azure.com' : '')
var aiKey = !empty(existingAiEndpoint) ? existingAiKey : (deployAiFoundry ? ai!.listKeys().key1 : '')
var aiDeploymentName = !empty(existingAiEndpoint) ? existingAiDeployment : (deployAiFoundry ? aiModelName : '')

// ---------------------------------------------------------------- Azure Web PubSub
resource pubsub 'Microsoft.SignalRService/webPubSub@2024-03-01' = if (deployWebPubSub) {
  name: '${base}-pubsub'
  location: location
  sku: {
    name: 'Free_F1'
    capacity: 1
  }
  properties: {
    disableLocalAuth: false
  }
}

// ---------------------------------------------------------------- App Service
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${base}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: appServiceSku
  }
  properties: {
    reserved: true
  }
}

resource web 'Microsoft.Web/sites@2024-04-01' = {
  name: '${base}-web'
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node server.js'
      alwaysOn: appServiceSku != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      webSocketsEnabled: true
      healthCheckPath: '/api/health'
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'HOSTNAME', value: '0.0.0.0' }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_KEY', value: cosmos.listKeys().primaryMasterKey }
        { name: 'COSMOS_DATABASE', value: 'coordinate' }
        { name: 'AZURE_MAPS_KEY', value: maps.listKeys().primaryKey }
        { name: 'AZURE_AI_FOUNDRY_ENDPOINT', value: aiEndpoint }
        { name: 'AZURE_AI_FOUNDRY_API_KEY', value: aiKey }
        { name: 'AZURE_AI_FOUNDRY_DEPLOYMENT', value: aiDeploymentName }
        { name: 'AZURE_WEB_PUBSUB_CONNECTION_STRING', value: deployWebPubSub ? pubsub!.listKeys().primaryConnectionString : '' }
        { name: 'AZURE_WEB_PUBSUB_HUB', value: 'coordinate' }
        { name: 'AZURE_AI_FOUNDRY_VISION', value: aiVision ? 'true' : 'false' }
        { name: 'NWS_USER_AGENT', value: nwsUserAgent }
        { name: 'VA511_FEED_URL', value: va511FeedUrl }
        { name: 'VA511_API_TOKEN', value: va511ApiToken }
        { name: 'VDOT_CAMERA_FEED_URL', value: vdotCameraFeedUrl }
        { name: 'PUBLIC_CAD_FEED_URL', value: publicCadFeedUrl }
        { name: 'NEWS_RSS_URLS', value: newsRssUrls }
        { name: 'COORDINATE_SESSION_SECRET', value: sessionSecret }
        { name: 'COORDINATE_COORDINATOR_PASSCODE', value: coordinatorPasscode }
        { name: 'COORDINATE_ACCESS_PASSWORD', value: accessPassword }
      ]
    }
  }
  dependsOn: [
    containers
    aiDeployment
  ]
}

// Allows the publish-profile deploy used by .github/workflows/azure-webapp.yml.
// Prefer OpenID Connect (azure/login) in production and set this to false.
resource scmPublishing 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: web
  name: 'scm'
  properties: {
    allow: true
  }
}

output webAppName string = web.name
output webAppUrl string = 'https://${web.properties.defaultHostName}'
output cosmosAccount string = cosmos.name
output mapsAccount string = maps.name
output aiEndpoint string = aiEndpoint
