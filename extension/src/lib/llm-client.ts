import {
  resolveLLMConfig,
  type LLMAuth,
  type LLMConfig,
  type ResolvedLLMConfig,
} from "./provider-registry";

export interface CallLLMOpts {
  maxTokens?: number;
}

export async function callLLM(
  config: LLMConfig,
  prompt: string,
  opts: CallLLMOpts = {},
): Promise<string> {
  const resolved = resolveLLMConfig(config);
  return resolved.protocol === "anthropic-messages"
    ? callAnthropicCompatible(resolved, prompt, opts.maxTokens)
    : callOpenAICompatible(resolved, prompt, opts.maxTokens);
}

export async function listProviderModels(config: LLMConfig): Promise<string[]> {
  const resolved = resolveLLMConfig(config);
  if (!resolved.modelsEndpoint) return [];
  const response = await fetch(resolved.modelsEndpoint, {
    method: "GET",
    headers: requestHeaders(resolved),
  });
  if (!response.ok) {
    throw await responseError(resolved, response, "models");
  }
  const data: unknown = await response.json();
  return extractModelIds(data).slice(0, 400);
}

export async function testProviderConnection(
  config: LLMConfig,
): Promise<string> {
  return callLLM(config, "Reply with exactly: JEOM_OK", { maxTokens: 16 });
}

async function callOpenAICompatible(
  resolved: ResolvedLLMConfig,
  prompt: string,
  maxTokens = 256,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: resolved.model,
    messages: [{ role: "user", content: prompt }],
    [resolved.tokenField]: maxTokens,
  };
  const response = await fetch(resolved.chatEndpoint, {
    method: "POST",
    headers: requestHeaders(resolved),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(resolved, response, "chat");
  }
  const text = extractOpenAIText(await response.json());
  if (text === null) {
    throw new Error(`${resolved.label} returned no text content.`);
  }
  return text;
}

async function callAnthropicCompatible(
  resolved: ResolvedLLMConfig,
  prompt: string,
  maxTokens = 256,
): Promise<string> {
  const response = await fetch(resolved.chatEndpoint, {
    method: "POST",
    headers: requestHeaders(resolved),
    body: JSON.stringify({
      model: resolved.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw await responseError(resolved, response, "messages");
  }
  const text = extractAnthropicText(await response.json());
  if (text === null) {
    throw new Error(`${resolved.label} returned no text content.`);
  }
  return text;
}

function requestHeaders(resolved: ResolvedLLMConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  applyAuth(headers, resolved.auth, resolved.apiKey);
  if (resolved.protocol === "anthropic-messages") {
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  if (resolved.provider === "openrouter") {
    headers["X-OpenRouter-Title"] = "Jeom";
  }
  return headers;
}

function applyAuth(
  headers: Record<string, string>,
  auth: LLMAuth,
  apiKey: string,
): void {
  if (auth === "none" || !apiKey) return;
  if (auth === "bearer") headers.Authorization = `Bearer ${apiKey}`;
  if (auth === "x-api-key") headers["x-api-key"] = apiKey;
  if (auth === "api-key") headers["api-key"] = apiKey;
}

function extractOpenAIText(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.choices)) return null;
  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
  return text || null;
}

function extractAnthropicText(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.content)) return null;
  const text = data.content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
  return text || null;
}

function extractModelIds(data: unknown): string[] {
  if (!isRecord(data)) return [];
  const rows = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : [];
  const ids = rows
    .map((row) => {
      if (typeof row === "string") return row;
      if (!isRecord(row)) return null;
      if (typeof row.id === "string") return row.id;
      if (typeof row.name === "string") {
        return row.name.replace(/^models\//, "");
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

async function responseError(
  resolved: ResolvedLLMConfig,
  response: Response,
  operation: string,
): Promise<Error> {
  const raw = await response.text();
  const safe = redactSecret(raw.slice(0, 600), resolved.apiKey);
  return new Error(
    `${resolved.label} ${operation} API ${response.status}: ${safe || response.statusText}`,
  );
}

function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
