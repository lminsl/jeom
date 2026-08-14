import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildPromptImprovementPrompt,
  improvePrompt,
} from "./prompt-improver";
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
});

describe("buildPromptImprovementPrompt", () => {
  test("includes current prompt and gold examples", () => {
    const prompt = buildPromptImprovementPrompt("Current prompt", [
      {
        sentenceText: "Sentence.",
        baselineNote: "Baseline",
        currentNote: "Current",
        goldNote: "Gold",
        comment: null,
      },
    ]);

    expect(prompt).toContain("Current prompt");
    expect(prompt).toContain("Sentence.");
    expect(prompt).toContain("Baseline");
    expect(prompt).toContain("Gold");
    expect(prompt).toContain("Return strict JSON only");
  });
});

describe("improvePrompt", () => {
  test("parses the LLM prompt-improvement response", async () => {
    mockedCallLLMDirect.mockResolvedValue(
      JSON.stringify({
        diagnosis: "Missing allusion rule.",
        patch: "Add allusion rule.",
        draftPrompt: "Updated prompt.",
      }),
    );

    const result = await improvePrompt({
      llm,
      currentPrompt: "Current prompt",
      examples: [
        {
          sentenceText: "Sentence.",
          baselineNote: "Baseline",
          currentNote: null,
          goldNote: "Gold",
          comment: null,
        },
      ],
    });

    expect(mockedCallLLMDirect).toHaveBeenCalledWith(
      llm,
      expect.stringContaining("Gold examples"),
      { maxTokens: 12000 },
    );
    expect(result.diagnosis).toBe("Missing allusion rule.");
    expect(result.patch).toBe("Add allusion rule.");
    expect(result.draftPrompt).toBe("Updated prompt.");
  });
});
