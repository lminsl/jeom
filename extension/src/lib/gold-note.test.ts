import { beforeEach, describe, expect, test, vi } from "vitest";

import { listGoldNotesForSession, saveGoldNote } from "./gold-note";

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
  vi.stubGlobal("crypto", { randomUUID: () => "gold-id" });
  return area;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("gold note storage", () => {
  test("saves and updates a gold note per session sentence", async () => {
    installChromeStorage();
    const session = {
      id: "session-1",
      url: "https://example.com",
      title: "Example",
      createdAt: "2026-05-29T00:00:00.000Z",
      provider: "openai" as const,
      model: "gpt-5-mini",
      sentences: [{ paragraphIndex: 0, sentenceIndex: 0, text: "Sentence." }],
      baselinePrompt: "Prompt",
      baselineRawResponse: "{}",
      baselineNotes: { "0::0": "Baseline" },
    };

    await saveGoldNote({
      session,
      sentence: session.sentences[0]!,
      sentenceKey: "0::0",
      sentenceText: "Sentence.",
      baselineNote: "Baseline",
      currentNote: null,
      goldNote: "Gold v1",
    });
    await saveGoldNote({
      session,
      sentence: session.sentences[0]!,
      sentenceKey: "0::0",
      sentenceText: "Sentence.",
      baselineNote: "Baseline",
      currentNote: "Current",
      goldNote: "Gold v2",
    });

    const notes = await listGoldNotesForSession("session-1");

    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("gold-id");
    expect(notes[0]?.goldNote).toBe("Gold v2");
    expect(notes[0]?.currentNote).toBe("Current");
  });
});
