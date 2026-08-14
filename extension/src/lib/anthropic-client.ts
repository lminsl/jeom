/** Thin Anthropic Messages-API wrapper. Single-shot prompt → text response.
 *  Used by selector-llm; deliberately narrow (no streaming, no tools, no
 *  multi-turn). For note-gen flexibility add a similar function later.
 *
 *  Two callers:
 *   - `callAnthropic` — standard api.anthropic.com endpoint, friendly model
 *     names (haiku/sonnet-4-6/opus-4-7) mapped to dated model IDs.
 *   - `callAnthropicFoundry` — custom endpoint (Azure AI Foundry's Anthropic
 *     compatibility layer); model is the literal deployment name, not a
 *     friendly alias. Request/response shape is identical to the standard
 *     Messages API, so the internal helper is shared.
 */

export type AnthropicModelName = "haiku" | "sonnet-4-6" | "opus-4-7";

const MODEL_IDS: Record<AnthropicModelName, string> = {
  "haiku": "claude-haiku-4-5-20251001",
  "sonnet-4-6": "claude-sonnet-4-6",
  "opus-4-7": "claude-opus-4-7",
};

const STANDARD_API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export interface CallAnthropicOpts {
  prompt: string;
  model: AnthropicModelName;
  apiKey: string;
  maxTokens?: number;
}

export interface CallAnthropicFoundryOpts {
  prompt: string;
  /** Deployment name as configured in Azure AI Foundry (e.g., "claude-opus-4-7"). */
  deployment: string;
  apiKey: string;
  /** Full URL ending in /anthropic/v1/messages. */
  endpoint: string;
  maxTokens?: number;
}

export async function callAnthropic(opts: CallAnthropicOpts): Promise<string> {
  if (!opts.apiKey) {
    throw new Error("No Anthropic API key. Set one in the extension Options page.");
  }
  return _callMessagesApi({
    url: STANDARD_API_URL,
    modelId: MODEL_IDS[opts.model],
    apiKey: opts.apiKey,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens,
  });
}

export async function callAnthropicFoundry(
  opts: CallAnthropicFoundryOpts,
): Promise<string> {
  if (!opts.apiKey) {
    throw new Error("No Anthropic Foundry API key. Set one in the extension Options page.");
  }
  if (!opts.endpoint) {
    throw new Error("No Anthropic Foundry endpoint URL. Set one in the extension Options page.");
  }
  return _callMessagesApi({
    url: opts.endpoint,
    modelId: opts.deployment,
    apiKey: opts.apiKey,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens,
  });
}

interface MessagesApiArgs {
  url: string;
  modelId: string;
  apiKey: string;
  prompt: string;
  maxTokens?: number;
}

async function _callMessagesApi(args: MessagesApiArgs): Promise<string> {
  const resp = await fetch(args.url, {
    method: "POST",
    headers: {
      "x-api-key": args.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.modelId,
      max_tokens: args.maxTokens ?? 256,
      messages: [{ role: "user", content: args.prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const data: unknown = await resp.json();
  const text = extractText(data);
  if (text === null) {
    throw new Error("Anthropic returned no text content");
  }
  return text;
}

function extractText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const first = content[0];
  if (typeof first !== "object" || first === null) return null;
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}
