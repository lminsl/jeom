import { beforeEach, describe, expect, test, vi } from "vitest";

import { annotate } from "./api";
import { callLLMDirect, type LLMConfig } from "./selector-llm";

vi.mock("./selector-llm", () => ({
  callLLMDirect: vi.fn(),
}));

const mockedCallLLMDirect = vi.mocked(callLLMDirect);

const llm = {
  provider: "openai" as const,
  model: "gpt-5-mini",
  apiKey: "sk-test",
} satisfies LLMConfig;

beforeEach(() => {
  mockedCallLLMDirect.mockReset();
  mockedCallLLMDirect.mockResolvedValue(
    JSON.stringify({
      sentences: [
        {
          global_index: 0,
          note: "A note.",
          why: "Because.",
          interaction: "hover",
        },
      ],
    }),
  );
});

describe("annotate", () => {
  test("uses a prompt override as the final note prompt template", async () => {
    const result = await annotate({
      llm,
      title: "Title",
      sentences: [{ paragraphIndex: 0, sentenceIndex: 0, text: "Sentence." }],
      promptOverride: "Custom prompt",
    });

    expect(mockedCallLLMDirect).toHaveBeenCalledWith(
      llm,
      expect.stringContaining("Custom prompt\n\nArticle title: Title"),
      { maxTokens: 20000 },
    );
    expect(result.telemetry.promptTemplate).toBe("Custom prompt");
    expect(result.telemetry.prompt).toContain("[0] Sentence.");
  });

  test("falls back to the bundled prompt when the override is blank", async () => {
    const result = await annotate({
      llm,
      title: "Title",
      sentences: [{ paragraphIndex: 0, sentenceIndex: 0, text: "Sentence." }],
      promptOverride: "   ",
    });

    expect(result.telemetry.promptTemplate).toContain("Prompt v7");
  });
});
