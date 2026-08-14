import { beforeEach, describe, expect, test, vi } from "vitest";

import { listDebugSessions, saveDebugSession } from "./debug-session";

interface ChromeStorageArea {
  data: Record<string, unknown>;
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

function installChromeStorage(initial: Record<string, unknown> = {}): ChromeStorageArea {
  const area: ChromeStorageArea = {
    data: { ...initial },
    get: async (keys) =>
      Object.fromEntries(keys.map((key) => [key, area.data[key]])),
    set: async (patch) => {
      Object.assign(area.data, patch);
    },
  };
  vi.stubGlobal("chrome", { storage: { local: area } });
  vi.stubGlobal("crypto", { randomUUID: () => "session-id" });
  return area;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("debug session storage", () => {
  test("saves the fixed sentence list and baseline prompt data", async () => {
    installChromeStorage();

    const session = await saveDebugSession({
      url: "https://example.com/article",
      title: "Article",
      llm: { provider: "openai", model: "gpt-5-mini", apiKey: "sk-test" },
      sentences: [{ paragraphIndex: 0, sentenceIndex: 0, text: "Sentence." }],
      annotation: {
        notes: { "0::0": "A note." },
        telemetry: {
          sentenceCount: 1,
          promptTemplate: "Prompt template",
          prompt: "Prompt template\n\nArticle title: Article",
          rawResponse: '{"sentences":[]}',
          noteCount: 1,
          latencyMs: 10,
          errorClass: null,
        },
      },
    });

    expect(session.id).toBe("session-id");
    expect(session.sentences[0]?.text).toBe("Sentence.");
    expect(session.baselinePrompt).toBe("Prompt template");
    expect(session.baselineNotes).toEqual({ "0::0": "A note." });
    await expect(listDebugSessions()).resolves.toHaveLength(1);
  });

  test("keeps only the newest twelve sessions", async () => {
    installChromeStorage();

    for (let i = 0; i < 13; i++) {
      await saveDebugSession({
        url: `https://example.com/${i}`,
        title: `Article ${i}`,
        llm: { provider: "openai", model: "gpt-5-mini", apiKey: "sk-test" },
        sentences: [{ paragraphIndex: 0, sentenceIndex: i, text: `S${i}.` }],
        annotation: {
          notes: {},
          telemetry: {
            sentenceCount: 1,
            promptTemplate: "Prompt template",
            prompt: "Prompt",
            rawResponse: "{}",
            noteCount: 0,
            latencyMs: 0,
            errorClass: null,
          },
        },
      });
    }

    const sessions = await listDebugSessions();

    expect(sessions).toHaveLength(12);
    expect(sessions[0]?.title).toBe("Article 12");
    expect(sessions.at(-1)?.title).toBe("Article 1");
  });
});
