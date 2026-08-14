import { getConfig, setConfig } from "../lib/storage";
import type { LLMConfig } from "../lib/selector-llm";

const renderModeEl = document.getElementById("renderMode") as HTMLSelectElement;
const llmProviderEl = document.getElementById("selectorProvider") as HTMLSelectElement;
const llmModelEl = document.getElementById("selectorModel") as HTMLSelectElement;
const llmModelTextEl = document.getElementById("selectorModelText") as HTMLInputElement;
const llmModelHintEl = document.getElementById("selectorModelHint") as HTMLDivElement;
const llmEndpointWrapEl = document.getElementById("selectorEndpointWrap") as HTMLDivElement;
const llmEndpointEl = document.getElementById("selectorEndpoint") as HTMLInputElement;
const llmApiKeyEl = document.getElementById("selectorApiKey") as HTMLInputElement;
const developerModeEl = document.getElementById("developerMode") as HTMLInputElement;
const shareDogfoodTelemetryEl = document.getElementById(
  "shareDogfoodTelemetry",
) as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const savedEl = document.getElementById("saved") as HTMLSpanElement;

const ANTHROPIC_MODELS = ["haiku", "sonnet-4-6", "opus-4-7"] as const;
const OPENAI_MODELS = ["gpt-5", "gpt-5-mini"] as const;

type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
type OpenAIModel = (typeof OPENAI_MODELS)[number];
type LLMProvider = "anthropic" | "anthropic-foundry" | "openai";

function populateLLMModels(provider: LLMProvider, preselect?: string): void {
  llmModelEl.innerHTML = "";
  if (provider === "anthropic-foundry") return;
  const models = provider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m === "haiku" ? "haiku (recommended — fast, cheap)" : m;
    llmModelEl.appendChild(opt);
  }
  if (preselect && (models as readonly string[]).includes(preselect)) {
    llmModelEl.value = preselect;
  }
}

function applyProviderVisibility(provider: LLMProvider): void {
  const isFoundry = provider === "anthropic-foundry";
  llmModelEl.style.display = isFoundry ? "none" : "";
  llmModelTextEl.style.display = isFoundry ? "" : "none";
  llmModelHintEl.style.display = isFoundry ? "" : "none";
  llmEndpointWrapEl.style.display = isFoundry ? "" : "none";
}

llmProviderEl.addEventListener("change", () => {
  const provider = llmProviderEl.value as LLMProvider;
  populateLLMModels(provider);
  applyProviderVisibility(provider);
});

async function load(): Promise<void> {
  const cfg = await getConfig();
  renderModeEl.value = cfg.renderMode;
  llmProviderEl.value = cfg.llm.provider;
  populateLLMModels(cfg.llm.provider, cfg.llm.model);
  applyProviderVisibility(cfg.llm.provider);
  if (cfg.llm.provider === "anthropic-foundry") {
    llmModelTextEl.value = cfg.llm.model;
    llmEndpointEl.value = cfg.llm.endpoint;
  }
  llmApiKeyEl.value = cfg.llm.apiKey;
  shareDogfoodTelemetryEl.checked = cfg.shareDogfoodTelemetry;
  developerModeEl.checked = cfg.developerMode;
}

saveBtn.addEventListener("click", async () => {
  const renderMode = renderModeEl.value as "reader" | "in-situ";
  const provider = llmProviderEl.value as LLMProvider;
  const apiKey = llmApiKeyEl.value.trim();

  let llm: LLMConfig;
  if (provider === "anthropic") {
    llm = { provider, model: llmModelEl.value as AnthropicModel, apiKey };
  } else if (provider === "openai") {
    llm = { provider, model: llmModelEl.value as OpenAIModel, apiKey };
  } else {
    llm = {
      provider: "anthropic-foundry",
      model: llmModelTextEl.value.trim(),
      apiKey,
      endpoint: llmEndpointEl.value.trim(),
    };
  }

  await setConfig({
    renderMode,
    llm,
    shareDogfoodTelemetry: shareDogfoodTelemetryEl.checked,
    developerMode: developerModeEl.checked,
  });
  savedEl.textContent = "saved ✓";
  setTimeout(() => (savedEl.textContent = ""), 2000);
});

void load();
