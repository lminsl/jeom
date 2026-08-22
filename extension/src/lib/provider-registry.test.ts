import { describe, expect, test } from "vitest";

import {
  deriveModelsEndpoint,
  normalizeChatEndpoint,
  PROVIDER_PRESETS,
  providerNeedsApiKey,
  resolveLLMConfig,
} from "./provider-registry";

describe("provider registry", () => {
  test("exposes every supported connection exactly once", () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("normalizes OpenAI-compatible base URLs", () => {
    expect(
      normalizeChatEndpoint("https://gateway.example/v1/", "openai-chat"),
    ).toBe("https://gateway.example/v1/chat/completions");
  });

  test("preserves Azure query parameters on full endpoints", () => {
    const endpoint =
      "https://example.openai.azure.com/openai/deployments/reader/chat/completions?api-version=2025-04-01-preview";
    expect(normalizeChatEndpoint(endpoint, "openai-chat")).toBe(endpoint);
  });

  test("derives a model catalog endpoint without chat query parameters", () => {
    expect(
      deriveModelsEndpoint(
        "https://gateway.example/v1/chat/completions?api-version=test",
        "openai-chat",
      ),
    ).toBe("https://gateway.example/v1/models");
    expect(deriveModelsEndpoint("not a URL", "openai-chat")).toBeUndefined();
  });

  test("migrates legacy Anthropic model aliases at request time", () => {
    const resolved = resolveLLMConfig({
      provider: "anthropic",
      model: "haiku",
      apiKey: "sk-ant-test",
    });
    expect(resolved.model).toBe("claude-haiku-4-5-20251001");
  });

  test("allows local providers without an API key", () => {
    const config = { provider: "ollama", model: "qwen3", apiKey: "" } as const;
    expect(providerNeedsApiKey(config)).toBe(false);
    expect(resolveLLMConfig(config).chatEndpoint).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  test("allows an unauthenticated custom gateway", () => {
    const config = {
      provider: "custom-openai",
      model: "reader-model",
      apiKey: "",
      endpoint: "http://localhost:8080/v1",
      protocol: "openai-chat",
      auth: "none",
    } as const;
    expect(providerNeedsApiKey(config)).toBe(false);
    expect(resolveLLMConfig(config).chatEndpoint).toBe(
      "http://localhost:8080/v1/chat/completions",
    );
  });

  test("rejects incomplete hosted connections", () => {
    expect(() =>
      resolveLLMConfig({ provider: "groq", model: "model", apiKey: "" }),
    ).toThrow("Groq needs an API key");
    expect(() =>
      resolveLLMConfig({
        provider: "custom-anthropic",
        model: "model",
        apiKey: "key",
      }),
    ).toThrow("needs an API endpoint");
  });

  test("does not invent a model catalog endpoint for Azure deployments", () => {
    expect(
      resolveLLMConfig({
        provider: "azure-openai",
        model: "reader",
        apiKey: "test-key",
        endpoint:
          "https://example.openai.azure.com/openai/deployments/reader/chat/completions?api-version=2025-04-01-preview",
      }).modelsEndpoint,
    ).toBeUndefined();
  });
});
