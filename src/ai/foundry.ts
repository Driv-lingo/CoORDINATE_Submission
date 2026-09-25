import { recordFailure, recordSuccess } from "@/providers/serviceHealth";
import type { AppConfig } from "@/config";

type FoundryConfig = NonNullable<AppConfig["foundry"]>;

export interface ChatRequest {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  imageDataUrl?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  latencyMs: number;
}

/**
 * Minimal Azure AI Foundry (Azure OpenAI-compatible) chat client using fetch.
 *
 * Supports:
 *  - the v1 API:           {endpoint}/openai/v1/chat/completions   (model = deployment name)
 *  - the deployments API:  {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=…
 *    (used when AZURE_AI_FOUNDRY_API_VERSION is set)
 *
 * Works with *.openai.azure.com and *.services.ai.azure.com resources. A
 * Foundry *project* endpoint (…/api/projects/…) is reduced to its resource origin.
 */
export function buildChatUrl(cfg: { endpoint: string; deployment: string; apiVersion?: string }): string {
  const url = new URL(cfg.endpoint);
  if (cfg.apiVersion) {
    return `${url.origin}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion)}`;
  }
  const idx = url.pathname.indexOf("/openai/v1");
  const base = idx >= 0 ? `${url.origin}${url.pathname.slice(0, idx)}/openai/v1` : `${url.origin}/openai/v1`;
  return `${base}/chat/completions`;
}

/** Every Foundry call's outcome feeds the data-source panel (never "connected" just because keys exist). */
export async function foundryChat(cfg: FoundryConfig, req: ChatRequest): Promise<ChatResponse> {
  try {
    const res = await foundryChatOnce(cfg, req);
    recordSuccess("azure-ai-foundry");
    return res;
  } catch (err) {
    recordFailure("azure-ai-foundry", err);
    throw err;
  }
}

async function foundryChatOnce(cfg: FoundryConfig, req: ChatRequest): Promise<ChatResponse> {
  const url = buildChatUrl(cfg);
  const userContent =
    req.imageDataUrl && cfg.vision
      ? [
          { type: "text", text: req.user },
          { type: "image_url", image_url: { url: req.imageDataUrl } },
        ]
      : req.user;

  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: userContent },
    ],
    max_completion_tokens: req.maxTokens ?? 700,
    temperature: 0,
  };
  if (!cfg.apiVersion) body.model = cfg.deployment;
  if (req.json) body.response_format = { type: "json_object" };

  const started = Date.now();
  // Some models (reasoning models) reject temperature / response_format; retry once without them.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": cfg.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 400 && /temperature/i.test(text) && "temperature" in body) {
          delete body.temperature;
          continue;
        }
        if (res.status === 400 && /response_format/i.test(text) && "response_format" in body) {
          delete body.response_format;
          continue;
        }
        if (res.status === 400 && /max_completion_tokens/i.test(text) && "max_completion_tokens" in body) {
          body.max_tokens = body.max_completion_tokens;
          delete body.max_completion_tokens;
          continue;
        }
        throw new Error(`Foundry HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error("Foundry returned an empty completion");
      return { content, model: data.model ?? cfg.deployment, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Foundry request failed after retries");
}

/** Extract the first JSON object from a completion (tolerates ```json fences). */
export function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in completion");
  return JSON.parse(candidate.slice(start, end + 1));
}
