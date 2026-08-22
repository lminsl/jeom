/** Thin chrome.storage.local wrappers for typed access. */

import {
  getProviderPreset,
  isProviderId,
  type LLMConfig,
  type LLMProtocol,
  type LLMAuth,
} from "./provider-registry";

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
  const rawProvider = import.meta.env.VITE_DEFAULT_PROVIDER;
  const provider = isProviderId(rawProvider) ? rawProvider : "openrouter";
  const preset = getProviderPreset(provider);
  const endpoint =
    import.meta.env.VITE_DEFAULT_ENDPOINT ??
    import.meta.env.VITE_DEFAULT_FOUNDRY_ENDPOINT;
  return {
    provider,
    model: import.meta.env.VITE_DEFAULT_MODEL || preset.defaultModel,
    apiKey,
    ...(endpoint ? { endpoint } : {}),
  };
}

const DEFAULTS: StoredConfig = {
  renderMode: "in-situ",
  llm: envSeededLLM(),
  developerMode: false,
  shareDogfoodTelemetry: false,
};

export async function getConfig(): Promise<StoredConfig> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const merged = { ...DEFAULTS, ...dropUndefined(stored) } as StoredConfig;
  return { ...merged, llm: normalizeStoredLLM(stored.llm) };
}

/** Content scripts need provider/model identity for cache and diagnostics, but
 * API calls happen in the service worker. Return a keyless copy so a BYOK
 * secret never enters the page-adjacent execution context. */
export async function getContentConfig(): Promise<StoredConfig> {
  const config = await getConfig();
  return { ...config, llm: { ...config.llm, apiKey: "" } };
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

/** Reads v0.2's three-provider objects and future provider-registry configs.
 * Unknown/corrupt values fall back to the build seed instead of crashing the
 * popup or content script. Legacy model aliases are intentionally preserved;
 * the registry resolves them at request time. */
function normalizeStoredLLM(value: unknown): LLMConfig {
  if (typeof value !== "object" || value === null) return DEFAULTS.llm;
  const candidate = value as Record<string, unknown>;
  if (!isProviderId(candidate.provider)) return DEFAULTS.llm;
  const preset = getProviderPreset(candidate.provider);
  const protocol = isProtocol(candidate.protocol)
    ? candidate.protocol
    : undefined;
  const auth = isAuth(candidate.auth) ? candidate.auth : undefined;
  return {
    provider: candidate.provider,
    model:
      typeof candidate.model === "string"
        ? candidate.model
        : preset.defaultModel,
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
    ...(typeof candidate.endpoint === "string"
      ? { endpoint: candidate.endpoint }
      : {}),
    ...(protocol ? { protocol } : {}),
    ...(auth ? { auth } : {}),
  };
}

function isProtocol(value: unknown): value is LLMProtocol {
  return value === "openai-chat" || value === "anthropic-messages";
}

function isAuth(value: unknown): value is LLMAuth {
  return (
    value === "bearer" ||
    value === "x-api-key" ||
    value === "api-key" ||
    value === "none"
  );
}
