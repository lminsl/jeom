export type LLMProtocol = "openai-chat" | "anthropic-messages";
export type LLMAuth = "bearer" | "x-api-key" | "api-key" | "none";

export type PresetProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "groq"
  | "mistral"
  | "deepseek"
  | "together"
  | "xai"
  | "cerebras"
  | "fireworks"
  | "ollama"
  | "lm-studio"
  | "azure-openai"
  | "anthropic-foundry";

export type CustomProviderId = "custom-openai" | "custom-anthropic";
export type LLMProviderId = PresetProviderId | CustomProviderId;

/** A single active BYOK connection. Provider behavior is derived from the
 * registry; custom connections persist protocol/auth because no preset can
 * safely infer them. */
export interface LLMConfig {
  provider: LLMProviderId;
  model: string;
  apiKey: string;
  /** Optional preset override, required for Azure/custom connections. May be
   * either a base URL or the full protocol endpoint. */
  endpoint?: string;
  protocol?: LLMProtocol;
  auth?: LLMAuth;
}

export interface ProviderPreset {
  id: LLMProviderId;
  label: string;
  description: string;
  protocol: LLMProtocol;
  auth: LLMAuth;
  chatEndpoint: string;
  modelsEndpoint?: string;
  defaultModel: string;
  modelSuggestions: readonly string[];
  requiresEndpoint?: boolean;
  allowsEndpointOverride?: boolean;
  derivesModelsEndpoint?: boolean;
  requiresApiKey: boolean;
  local?: boolean;
  documentationUrl: string;
  /** OpenAI reasoning models use this newer field; most compatible APIs still
   * expect max_tokens. */
  tokenField?: "max_tokens" | "max_completion_tokens";
}

const presets = [
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "One key for hundreds of hosted models with provider routing.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    defaultModel: "openrouter/auto",
    modelSuggestions: [
      "openrouter/auto",
      "anthropic/claude-sonnet-4.6",
      "google/gemini-3.7-flash",
    ],
    requiresApiKey: true,
    documentationUrl: "https://openrouter.ai/docs/quickstart",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Direct OpenAI API connection.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.openai.com/v1/chat/completions",
    modelsEndpoint: "https://api.openai.com/v1/models",
    defaultModel: "gpt-5-mini",
    modelSuggestions: ["gpt-5-mini", "gpt-5"],
    requiresApiKey: true,
    documentationUrl: "https://platform.openai.com/docs/api-reference/chat",
    tokenField: "max_completion_tokens",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Direct Claude Messages API connection.",
    protocol: "anthropic-messages",
    auth: "x-api-key",
    chatEndpoint: "https://api.anthropic.com/v1/messages",
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    defaultModel: "claude-haiku-4-5-20251001",
    modelSuggestions: [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ],
    requiresApiKey: true,
    documentationUrl: "https://docs.anthropic.com/en/api/messages",
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Gemini through Google's OpenAI-compatible endpoint.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    modelsEndpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
    defaultModel: "gemini-3.7-flash",
    modelSuggestions: ["gemini-3.7-flash", "gemini-flash-latest"],
    requiresApiKey: true,
    documentationUrl: "https://ai.google.dev/gemini-api/docs/openai",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Fast hosted inference through an OpenAI-compatible API.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    defaultModel: "openai/gpt-oss-20b",
    modelSuggestions: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
    requiresApiKey: true,
    documentationUrl: "https://console.groq.com/docs/openai",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    description: "Mistral's hosted chat-completions API.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.mistral.ai/v1/chat/completions",
    modelsEndpoint: "https://api.mistral.ai/v1/models",
    defaultModel: "mistral-small-latest",
    modelSuggestions: ["mistral-small-latest", "mistral-large-latest"],
    requiresApiKey: true,
    documentationUrl: "https://docs.mistral.ai/api/endpoint/chat",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek's OpenAI-compatible API.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.deepseek.com/chat/completions",
    modelsEndpoint: "https://api.deepseek.com/models",
    defaultModel: "deepseek-chat",
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
    requiresApiKey: true,
    documentationUrl: "https://api-docs.deepseek.com/",
  },
  {
    id: "together",
    label: "Together AI",
    description: "Hosted open models through an OpenAI-compatible API.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.together.ai/v1/chat/completions",
    modelsEndpoint: "https://api.together.ai/v1/models",
    defaultModel: "openai/gpt-oss-20b",
    modelSuggestions: [
      "openai/gpt-oss-20b",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    ],
    requiresApiKey: true,
    documentationUrl: "https://docs.together.ai/docs/quickstart",
  },
  {
    id: "xai",
    label: "xAI",
    description: "Grok models through xAI's chat-completions API.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.x.ai/v1/chat/completions",
    modelsEndpoint: "https://api.x.ai/v1/models",
    defaultModel: "latest",
    modelSuggestions: ["latest", "grok-4.6"],
    requiresApiKey: true,
    documentationUrl:
      "https://docs.x.ai/developers/rest-api-reference/inference/chat",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    description: "High-speed hosted inference with OpenAI compatibility.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "https://api.cerebras.ai/v1/chat/completions",
    modelsEndpoint: "https://api.cerebras.ai/v1/models",
    defaultModel: "gpt-oss-120b",
    modelSuggestions: ["gpt-oss-120b", "zai-glm-4.7"],
    requiresApiKey: true,
    documentationUrl: "https://inference-docs.cerebras.ai/resources/openai",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    description: "Hosted open models and deployments with OpenAI compatibility.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint:
      "https://api.fireworks.ai/inference/v1/chat/completions",
    modelsEndpoint: "https://api.fireworks.ai/inference/v1/models",
    defaultModel: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    modelSuggestions: [
      "accounts/fireworks/models/llama-v3p1-8b-instruct",
    ],
    requiresApiKey: true,
    documentationUrl: "https://docs.fireworks.ai/tools-sdks/openai-compatibility",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    description: "Use models running locally through Ollama.",
    protocol: "openai-chat",
    auth: "none",
    chatEndpoint: "http://localhost:11434/v1/chat/completions",
    modelsEndpoint: "http://localhost:11434/v1/models",
    defaultModel: "llama3.2",
    modelSuggestions: ["llama3.2", "qwen3", "gpt-oss"],
    requiresApiKey: false,
    local: true,
    allowsEndpointOverride: true,
    derivesModelsEndpoint: true,
    documentationUrl: "https://docs.ollama.com/openai",
  },
  {
    id: "lm-studio",
    label: "LM Studio (local)",
    description: "Use any model served by LM Studio on this computer.",
    protocol: "openai-chat",
    auth: "none",
    chatEndpoint: "http://localhost:1234/v1/chat/completions",
    modelsEndpoint: "http://localhost:1234/v1/models",
    defaultModel: "local-model",
    modelSuggestions: [],
    requiresApiKey: false,
    local: true,
    allowsEndpointOverride: true,
    derivesModelsEndpoint: true,
    documentationUrl: "https://lmstudio.ai/docs/developer/openai-compat",
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    description: "Azure deployment using a full chat-completions endpoint.",
    protocol: "openai-chat",
    auth: "api-key",
    chatEndpoint: "",
    defaultModel: "deployment-name",
    modelSuggestions: [],
    requiresEndpoint: true,
    allowsEndpointOverride: true,
    requiresApiKey: true,
    documentationUrl:
      "https://learn.microsoft.com/azure/ai-foundry/openai/reference",
  },
  {
    id: "anthropic-foundry",
    label: "Anthropic via Azure AI Foundry",
    description: "Claude deployment through Azure's Anthropic-compatible API.",
    protocol: "anthropic-messages",
    auth: "x-api-key",
    chatEndpoint: "",
    defaultModel: "claude-opus-4-7",
    modelSuggestions: [],
    requiresEndpoint: true,
    allowsEndpointOverride: true,
    requiresApiKey: true,
    documentationUrl:
      "https://learn.microsoft.com/azure/ai-foundry/model-inference/how-to/use-chat-completions",
  },
  {
    id: "custom-openai",
    label: "Custom OpenAI-compatible",
    description: "Any gateway or service exposing /chat/completions.",
    protocol: "openai-chat",
    auth: "bearer",
    chatEndpoint: "",
    defaultModel: "",
    modelSuggestions: [],
    requiresEndpoint: true,
    allowsEndpointOverride: true,
    derivesModelsEndpoint: true,
    requiresApiKey: true,
    documentationUrl: "https://platform.openai.com/docs/api-reference/chat",
  },
  {
    id: "custom-anthropic",
    label: "Custom Anthropic-compatible",
    description: "Any gateway or service exposing a Messages API.",
    protocol: "anthropic-messages",
    auth: "x-api-key",
    chatEndpoint: "",
    defaultModel: "",
    modelSuggestions: [],
    requiresEndpoint: true,
    allowsEndpointOverride: true,
    derivesModelsEndpoint: true,
    requiresApiKey: true,
    documentationUrl: "https://docs.anthropic.com/en/api/messages",
  },
] as const satisfies readonly ProviderPreset[];

export const PROVIDER_PRESETS: readonly ProviderPreset[] = presets;

const PRESET_BY_ID = new Map<LLMProviderId, ProviderPreset>(
  presets.map((preset) => [preset.id, preset]),
);

export function isProviderId(value: unknown): value is LLMProviderId {
  return typeof value === "string" && PRESET_BY_ID.has(value as LLMProviderId);
}

export function getProviderPreset(id: LLMProviderId): ProviderPreset {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) throw new Error(`Unsupported provider: ${id}`);
  return preset;
}

export interface ResolvedLLMConfig {
  provider: LLMProviderId;
  label: string;
  protocol: LLMProtocol;
  auth: LLMAuth;
  model: string;
  apiKey: string;
  chatEndpoint: string;
  modelsEndpoint?: string;
  tokenField: "max_tokens" | "max_completion_tokens";
  local: boolean;
}

const LEGACY_ANTHROPIC_MODELS: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  "sonnet-4-6": "claude-sonnet-4-6",
  "opus-4-7": "claude-opus-4-7",
};

export function resolveLLMConfig(config: LLMConfig): ResolvedLLMConfig {
  const preset = getProviderPreset(config.provider);
  const protocol =
    config.provider.startsWith("custom-") && config.protocol
      ? config.protocol
      : preset.protocol;
  const auth =
    config.provider.startsWith("custom-") && config.auth
      ? config.auth
      : preset.auth;
  const rawEndpoint = config.endpoint?.trim() || preset.chatEndpoint;
  if (!rawEndpoint) {
    throw new Error(`${preset.label} needs an API endpoint.`);
  }
  const model =
    config.provider === "anthropic"
      ? LEGACY_ANTHROPIC_MODELS[config.model] ?? config.model
      : config.model || preset.defaultModel;
  if (!model) throw new Error(`${preset.label} needs a model name.`);
  if (preset.requiresApiKey && auth !== "none" && !config.apiKey.trim()) {
    throw new Error(`${preset.label} needs an API key.`);
  }
  return {
    provider: config.provider,
    label: preset.label,
    protocol,
    auth,
    model,
    apiKey: config.apiKey.trim(),
    chatEndpoint: normalizeChatEndpoint(rawEndpoint, protocol),
    modelsEndpoint:
      config.endpoint && preset.derivesModelsEndpoint
        ? deriveModelsEndpoint(rawEndpoint, protocol)
        : preset.modelsEndpoint,
    tokenField: preset.tokenField ?? "max_tokens",
    local: preset.local ?? false,
  };
}

/** Accept a base URL or a full chat endpoint. Query strings (notably Azure's
 * api-version) remain attached after the path is normalized. */
export function normalizeChatEndpoint(
  value: string,
  protocol: LLMProtocol,
): string {
  const url = new URL(value.trim());
  const suffix =
    protocol === "openai-chat" ? "/chat/completions" : "/messages";
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith(suffix)) url.pathname = `${path}${suffix}`;
  return url.toString();
}

export function deriveModelsEndpoint(
  value: string,
  protocol: LLMProtocol,
): string | undefined {
  try {
    const url = new URL(normalizeChatEndpoint(value, protocol));
    const suffix =
      protocol === "openai-chat" ? "/chat/completions" : "/messages";
    url.pathname = `${url.pathname.slice(0, -suffix.length)}/models`;
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function providerNeedsApiKey(config: LLMConfig): boolean {
  const preset = getProviderPreset(config.provider);
  const auth =
    config.provider.startsWith("custom-") && config.auth
      ? config.auth
      : preset.auth;
  return preset.requiresApiKey && auth !== "none";
}
