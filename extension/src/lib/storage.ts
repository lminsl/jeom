/** Thin chrome.storage.local wrappers for typed access. */

import type { LLMConfig } from "./selector-llm";

export interface StoredConfig {
  /** Which render path to use after notes come back. */
  renderMode: "reader" | "in-situ";
  /** The single LLM used for every pipeline call (selector + note-gen + any
   *  future). One provider/model in Options, one quota to watch. */
  llm: LLMConfig;
  /** When true, popup stays open after ACTIVATE and shows a live trace of
   *  [jeom] logs from content + selector-llm — so the user (also
   *  the developer) doesn't have to F12 the page to see what's happening. */
  developerMode: boolean;
  /** Explicit consent for optional diagnostic sharing. */
  shareDogfoodTelemetry: boolean;
}

/** Seed defaults from build-time env vars (Vite `.env.local`). Optional —
 *  Options page is still the source of truth and overrides these once the
 *  user saves anything. See README "Install via your AI coding agent". */
function envSeededLLM(): LLMConfig {
  const apiKey = import.meta.env.VITE_DEFAULT_API_KEY ?? "";
  const provider = import.meta.env.VITE_DEFAULT_PROVIDER;
  const model = import.meta.env.VITE_DEFAULT_MODEL ?? "";

  if (provider === "openai") {
    const m = model === "gpt-5" || model === "gpt-5-mini" ? model : "gpt-5-mini";
    return { provider, model: m, apiKey };
  }
  if (provider === "anthropic-foundry") {
    return {
      provider,
      model: model || "claude-opus-4-7",
      apiKey,
      endpoint: import.meta.env.VITE_DEFAULT_FOUNDRY_ENDPOINT ?? "",
    };
  }
  const m =
    model === "haiku" || model === "sonnet-4-6" || model === "opus-4-7"
      ? model
      : "haiku";
  return { provider: "anthropic", model: m, apiKey };
}

const DEFAULTS: StoredConfig = {
  renderMode: "in-situ",
  llm: envSeededLLM(),
  developerMode: false,
  shareDogfoodTelemetry: false,
};

export async function getConfig(): Promise<StoredConfig> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...dropUndefined(stored) } as StoredConfig;
}

export async function setConfig(patch: Partial<StoredConfig>): Promise<void> {
  await chrome.storage.local.set(patch);
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, unknown] => entry[1] !== undefined,
    ),
  );
}
