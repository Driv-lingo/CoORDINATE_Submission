/**
 * Runtime configuration. Every Azure integration is optional: when its
 * settings are absent, CoORDINATE falls back to a local implementation so the
 * complete product can be demonstrated without credentials.
 */

const env = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export function config() {
  const forceLocal = env("COORDINATE_FORCE_LOCAL") === "true";
  return {
    foundry: forceLocal
      ? undefined
      : env("AZURE_AI_FOUNDRY_ENDPOINT") && env("AZURE_AI_FOUNDRY_API_KEY") && env("AZURE_AI_FOUNDRY_DEPLOYMENT")
        ? {
            endpoint: env("AZURE_AI_FOUNDRY_ENDPOINT")!,
            apiKey: env("AZURE_AI_FOUNDRY_API_KEY")!,
            deployment: env("AZURE_AI_FOUNDRY_DEPLOYMENT")!,
            apiVersion: env("AZURE_AI_FOUNDRY_API_VERSION"),
            timeoutMs: Number(env("AZURE_AI_FOUNDRY_TIMEOUT_MS") ?? 15000),
            vision: env("AZURE_AI_FOUNDRY_VISION") === "true",
          }
        : undefined,
    cosmos: forceLocal
      ? undefined
      : env("COSMOS_ENDPOINT") && env("COSMOS_KEY")
        ? {
            endpoint: env("COSMOS_ENDPOINT")!,
            key: env("COSMOS_KEY")!,
            database: env("COSMOS_DATABASE") ?? "coordinate",
          }
        : undefined,
    maps: forceLocal ? undefined : env("AZURE_MAPS_KEY") ? { key: env("AZURE_MAPS_KEY")! } : undefined,
    webPubSub: forceLocal
      ? undefined
      : env("AZURE_WEB_PUBSUB_CONNECTION_STRING")
        ? { connectionString: env("AZURE_WEB_PUBSUB_CONNECTION_STRING")!, hub: env("AZURE_WEB_PUBSUB_HUB") ?? "coordinate" }
        : undefined,
    operationName: env("COORDINATE_OPERATION_NAME") ?? "TS Delphine — Roanoke Valley",
  };
}

export type AppConfig = ReturnType<typeof config>;
