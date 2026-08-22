import { afterEach, describe, expect, test, vi } from "vitest";

import {
  callLLM,
  listProviderModels,
  testProviderConnection,
} from "./llm-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unified LLM client", () => {
  test("calls an OpenAI-compatible service from a custom connection", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { content: "answer" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await callLLM(
      {
        provider: "custom-openai",
        model: "reader-model",
        apiKey: "gateway-secret",
        endpoint: "https://gateway.example/v1",
        protocol: "openai-chat",
        auth: "bearer",
      },
      "read this",
      { maxTokens: 42 },
    );

    expect(text).toBe("answer");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gateway.example/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer gateway-secret",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "reader-model",
      max_tokens: 42,
      messages: [{ role: "user", content: "read this" }],
    });
  });

  test("calls Anthropic Messages with its native auth headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ content: [{ type: "text", text: "answer" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(
      {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-secret",
      },
      "read this",
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "x-api-key": "sk-ant-secret",
      "anthropic-version": "2023-06-01",
    });
  });

  test("redacts the configured key from provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("invalid key gateway-secret", { status: 401 }),
      ),
    );

    await expect(
      callLLM(
        {
          provider: "custom-openai",
          model: "reader-model",
          apiKey: "gateway-secret",
          endpoint: "https://gateway.example/v1",
          protocol: "openai-chat",
          auth: "bearer",
        },
        "read this",
      ),
    ).rejects.toThrow("invalid key [redacted]");
  });

  test("reads model catalogs exposed in OpenAI format", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ id: "z-model" }, { id: "a-model" }] }),
      ),
    );

    await expect(
      listProviderModels({
        provider: "openrouter",
        model: "openrouter/auto",
        apiKey: "sk-or-test",
      }),
    ).resolves.toEqual(["a-model", "z-model"]);
  });

  test("reads alternate model catalogs and removes duplicates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          models: ["z-model", { name: "models/a-model" }, { id: "z-model" }],
        }),
      ),
    );

    await expect(
      listProviderModels({
        provider: "ollama",
        model: "qwen3",
        apiKey: "",
      }),
    ).resolves.toEqual(["a-model", "z-model"]);
  });

  test("lists Gemini models through Google's OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ id: "gemini-3.7-flash" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listProviderModels({
        provider: "google",
        model: "gemini-3.7-flash",
        apiKey: "test-key",
      }),
    ).resolves.toEqual(["gemini-3.7-flash"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  test("rejects successful responses that contain no text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [] })));

    await expect(
      callLLM(
        {
          provider: "openrouter",
          model: "test-model",
          apiKey: "test-key",
        },
        "read this",
      ),
    ).rejects.toThrow("returned no text content");
  });

  test("uses a minimal deterministic prompt for connection tests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { content: "JEOM_OK" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testProviderConnection({
        provider: "openrouter",
        model: "test-model",
        apiKey: "test-key",
      }),
    ).resolves.toBe("JEOM_OK");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [{ role: "user", content: "Reply with exactly: JEOM_OK" }],
      max_tokens: 16,
    });
  });
});
