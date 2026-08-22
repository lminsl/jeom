import {
  getProviderPreset,
  normalizeChatEndpoint,
  resolveLLMConfig,
  type LLMAuth,
  type LLMConfig,
  type LLMProviderId,
  type ProviderPreset,
} from "../lib/provider-registry";
import { getConfig, setConfig } from "../lib/storage";

const renderModeEl = element<HTMLSelectElement>("renderMode");
const llmProviderEl = element<HTMLSelectElement>("llmProvider");
const llmModelEl = element<HTMLInputElement>("llmModel");
const modelSuggestionsEl = element<HTMLDataListElement>("modelSuggestions");
const endpointWrapEl = element<HTMLDivElement>("endpointWrap");
const llmEndpointEl = element<HTMLInputElement>("llmEndpoint");
const endpointHintEl = element<HTMLDivElement>("endpointHint");
const authWrapEl = element<HTMLDivElement>("authWrap");
const llmAuthEl = element<HTMLSelectElement>("llmAuth");
const apiKeyWrapEl = element<HTMLDivElement>("apiKeyWrap");
const apiKeyOptionalEl = element<HTMLSpanElement>("apiKeyOptional");
const llmApiKeyEl = element<HTMLInputElement>("llmApiKey");
const apiKeyHintEl = element<HTMLDivElement>("apiKeyHint");
const providerGlyphEl = element<HTMLDivElement>("providerGlyph");
const providerNameEl = element<HTMLDivElement>("providerName");
const providerDescriptionEl = element<HTMLDivElement>("providerDescription");
const protocolBadgeEl = element<HTMLSpanElement>("protocolBadge");
const providerHintEl = element<HTMLDivElement>("providerHint");
const endpointReadoutEl = element<HTMLDivElement>("endpointReadout");
const discoverModelsBtn = element<HTMLButtonElement>("discoverModels");
const testConnectionBtn = element<HTMLButtonElement>("testConnection");
const connectionStatusEl = element<HTMLSpanElement>("connectionStatus");
const developerModeEl = element<HTMLInputElement>("developerMode");
const shareDogfoodTelemetryEl = element<HTMLInputElement>(
  "shareDogfoodTelemetry",
);
const saveBtn = element<HTMLButtonElement>("save");
const savedEl = element<HTMLSpanElement>("saved");

const GROUPS: ReadonlyArray<{
  label: string;
  providers: readonly LLMProviderId[];
}> = [
  { label: "Router", providers: ["openrouter"] },
  {
    label: "Direct providers",
    providers: [
      "openai",
      "anthropic",
      "google",
      "groq",
      "mistral",
      "deepseek",
      "together",
      "xai",
      "cerebras",
      "fireworks",
    ],
  },
  { label: "Local models", providers: ["ollama", "lm-studio"] },
  {
    label: "Cloud & custom",
    providers: [
      "azure-openai",
      "anthropic-foundry",
      "custom-openai",
      "custom-anthropic",
    ],
  },
];

let providerTouched = false;

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing options element #${id}`);
  return value as T;
}

function populateProviders(): void {
  llmProviderEl.replaceChildren();
  for (const group of GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const id of group.providers) {
      const preset = getProviderPreset(id);
      const option = document.createElement("option");
      option.value = id;
      option.textContent = preset.label;
      optgroup.append(option);
    }
    llmProviderEl.append(optgroup);
  }
}

function selectedProvider(): LLMProviderId {
  return llmProviderEl.value as LLMProviderId;
}

function providerGlyph(preset: ProviderPreset): string {
  const words = preset.label.replace(/\s*\(.+\)$/, "").split(/\s+/);
  return words.length > 1
    ? words
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase()
    : preset.label.slice(0, 2).toUpperCase();
}

function populateModelSuggestions(models: readonly string[]): void {
  modelSuggestionsEl.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    modelSuggestionsEl.append(option);
  }
}

function isCustomProvider(id: LLMProviderId): boolean {
  return id === "custom-openai" || id === "custom-anthropic";
}

function applyProvider(
  id: LLMProviderId,
  options: { resetValues?: boolean } = {},
): void {
  const preset = getProviderPreset(id);
  const isCustom = isCustomProvider(id);
  const showEndpoint =
    preset.requiresEndpoint === true || preset.allowsEndpointOverride === true;

  providerGlyphEl.textContent = providerGlyph(preset);
  providerNameEl.textContent = preset.label;
  providerDescriptionEl.textContent = preset.description;
  protocolBadgeEl.textContent =
    preset.protocol === "openai-chat"
      ? "OpenAI-compatible"
      : "Anthropic-compatible";
  providerHintEl.textContent = providerHint(preset);
  endpointWrapEl.hidden = !showEndpoint;
  authWrapEl.hidden = !isCustom;
  llmAuthEl.value = preset.auth;
  endpointHintEl.textContent = preset.requiresEndpoint
    ? "Enter the endpoint URL."
    : "Optional.";

  if (options.resetValues) {
    llmModelEl.value = preset.defaultModel;
    llmEndpointEl.value = preset.requiresEndpoint ? "" : preset.chatEndpoint;
    llmApiKeyEl.value = "";
  }

  populateModelSuggestions(preset.modelSuggestions);
  applyAuthenticationVisibility();
  updateEndpointReadout();
  clearConnectionStatus();
}

function providerHint(preset: ProviderPreset): string {
  if (preset.local) {
    return "No API key required.";
  }
  if (isCustomProvider(preset.id)) {
    return "Enter your endpoint and authentication method.";
  }
  return "Choose a model supported by this service.";
}

function applyAuthenticationVisibility(): void {
  const preset = getProviderPreset(selectedProvider());
  const auth = (isCustomProvider(preset.id)
    ? llmAuthEl.value
    : preset.auth) as LLMAuth;
  const needsKey = preset.requiresApiKey && auth !== "none";
  apiKeyWrapEl.hidden = !needsKey;
  apiKeyOptionalEl.textContent = needsKey ? "" : "(not required)";
  apiKeyHintEl.textContent = needsKey
    ? "Stored locally in Chrome."
    : "No API key required.";
}

function buildLLMConfig(): LLMConfig {
  const provider = selectedProvider();
  const preset = getProviderPreset(provider);
  const llm: LLMConfig = {
    provider,
    model: llmModelEl.value.trim() || preset.defaultModel,
    apiKey: llmApiKeyEl.value.trim(),
  };
  if (!endpointWrapEl.hidden && llmEndpointEl.value.trim()) {
    llm.endpoint = llmEndpointEl.value.trim();
  }
  if (isCustomProvider(provider)) {
    llm.protocol = preset.protocol;
    llm.auth = llmAuthEl.value as LLMAuth;
  }
  return llm;
}

function updateEndpointReadout(): void {
  const preset = getProviderPreset(selectedProvider());
  const rawEndpoint =
    (!endpointWrapEl.hidden ? llmEndpointEl.value.trim() : "") ||
    preset.chatEndpoint;
  if (!rawEndpoint) {
    endpointReadoutEl.textContent = "Enter an endpoint to complete this connection.";
    return;
  }
  try {
    endpointReadoutEl.textContent = normalizeChatEndpoint(
      rawEndpoint,
      preset.protocol,
    );
  } catch {
    endpointReadoutEl.textContent = "Endpoint is not a valid URL yet.";
  }
}

function detectProviderFromKey(key: string): LLMProviderId | null {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AIza")) return "google";
  if (key.startsWith("xai-")) return "xai";
  return null;
}

function setConnectionStatus(
  text: string,
  kind: "ok" | "error" | "neutral" = "neutral",
): void {
  connectionStatusEl.textContent = text;
  connectionStatusEl.classList.toggle("ok", kind === "ok");
  connectionStatusEl.classList.toggle("error", kind === "error");
}

function clearConnectionStatus(): void {
  setConnectionStatus("");
}

async function withBusyButton(
  button: HTMLButtonElement,
  busyLabel: string,
  work: () => Promise<void>,
): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await work();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

interface ModelsResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

interface TestResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

llmProviderEl.addEventListener("change", () => {
  providerTouched = true;
  applyProvider(selectedProvider(), { resetValues: true });
});

llmAuthEl.addEventListener("change", () => {
  applyAuthenticationVisibility();
  clearConnectionStatus();
});

llmEndpointEl.addEventListener("input", () => {
  updateEndpointReadout();
  clearConnectionStatus();
});

llmModelEl.addEventListener("input", clearConnectionStatus);

llmApiKeyEl.addEventListener("input", () => {
  clearConnectionStatus();
  if (!providerTouched) {
    const detected = detectProviderFromKey(llmApiKeyEl.value.trim());
    if (detected && detected !== selectedProvider()) {
      const key = llmApiKeyEl.value;
      llmProviderEl.value = detected;
      applyProvider(detected, { resetValues: true });
      llmApiKeyEl.value = key;
      setConnectionStatus(
        `Recognized a ${getProviderPreset(detected).label} key.`,
        "ok",
      );
    }
  }
});

discoverModelsBtn.addEventListener("click", () => {
  void withBusyButton(discoverModelsBtn, "Looking…", async () => {
    try {
      const llm = buildLLMConfig();
      resolveLLMConfig(llm);
      setConnectionStatus("Loading models…");
      const response = (await chrome.runtime.sendMessage({
        type: "LIST_PROVIDER_MODELS_REQUEST",
        llm,
      })) as ModelsResponse | undefined;
      if (!response?.ok) {
        throw new Error(response?.error || "The provider did not respond.");
      }
      const models = response.models ?? [];
      if (models.length === 0) {
        setConnectionStatus(
          "No models returned. Enter a model ID.",
        );
        return;
      }
      populateModelSuggestions(models);
      if (!llmModelEl.value.trim() || llmModelEl.value === "local-model") {
        llmModelEl.value = models[0] ?? "";
      }
      setConnectionStatus(
        `Found ${models.length} model${models.length === 1 ? "" : "s"}.`,
        "ok",
      );
    } catch (error) {
      setConnectionStatus(errorMessage(error), "error");
    }
  });
});

testConnectionBtn.addEventListener("click", () => {
  void withBusyButton(testConnectionBtn, "Testing…", async () => {
    try {
      const llm = buildLLMConfig();
      resolveLLMConfig(llm);
      setConnectionStatus("Testing connection…");
      const response = (await chrome.runtime.sendMessage({
        type: "TEST_PROVIDER_REQUEST",
        llm,
      })) as TestResponse | undefined;
      if (!response?.ok) {
        throw new Error(response?.error || "The provider did not respond.");
      }
      setConnectionStatus("Connection works.", "ok");
    } catch (error) {
      setConnectionStatus(errorMessage(error), "error");
    }
  });
});

saveBtn.addEventListener("click", () => {
  void withBusyButton(saveBtn, "Saving…", async () => {
    try {
      const llm = buildLLMConfig();
      resolveLLMConfig(llm);
      await setConfig({
        renderMode: renderModeEl.value as "reader" | "in-situ",
        llm,
        shareDogfoodTelemetry: shareDogfoodTelemetryEl.checked,
        developerMode: developerModeEl.checked,
      });
      savedEl.textContent = "Saved.";
      setTimeout(() => {
        savedEl.textContent = "";
      }, 2200);
    } catch (error) {
      setConnectionStatus(errorMessage(error), "error");
    }
  });
});

async function load(): Promise<void> {
  populateProviders();
  const cfg = await getConfig();
  llmProviderEl.value = cfg.llm.provider;
  renderModeEl.value = cfg.renderMode;
  llmModelEl.value = cfg.llm.model;
  llmEndpointEl.value = cfg.llm.endpoint ?? "";
  llmApiKeyEl.value = cfg.llm.apiKey;
  shareDogfoodTelemetryEl.checked = cfg.shareDogfoodTelemetry;
  developerModeEl.checked = cfg.developerMode;
  applyProvider(cfg.llm.provider);
  llmAuthEl.value =
    cfg.llm.auth ?? getProviderPreset(cfg.llm.provider).auth;
  applyAuthenticationVisibility();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void load();
