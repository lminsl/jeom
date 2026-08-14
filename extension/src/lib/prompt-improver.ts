import { callLLMDirect, type LLMConfig } from "./selector-llm";

export interface PromptImprovementExample {
  sentenceText: string;
  baselineNote: string | null;
  currentNote: string | null;
  goldNote: string;
  comment: string | null;
}

export interface PromptImprovementResult {
  diagnosis: string;
  patch: string;
  draftPrompt: string;
  rawResponse: string;
}

interface RawPromptImprovement {
  diagnosis?: unknown;
  patch?: unknown;
  draftPrompt?: unknown;
  draft_prompt?: unknown;
}

export async function improvePrompt(opts: {
  llm: LLMConfig;
  currentPrompt: string;
  examples: PromptImprovementExample[];
}): Promise<PromptImprovementResult> {
  if (opts.examples.length === 0) {
    throw new Error("Add at least one saved gold note before improving the prompt.");
  }

  const prompt = buildPromptImprovementPrompt(opts.currentPrompt, opts.examples);
  const rawResponse = await callLLMDirect(opts.llm, prompt, { maxTokens: 12000 });
  const parsed = JSON.parse(stripCodeFence(rawResponse)) as RawPromptImprovement;
  const diagnosis = stringField(parsed.diagnosis, "diagnosis");
  const patch = stringField(parsed.patch, "patch");
  const draftPrompt = stringField(
    parsed.draftPrompt ?? parsed.draft_prompt,
    "draftPrompt",
  );
  return { diagnosis, patch, draftPrompt, rawResponse };
}

export function buildPromptImprovementPrompt(
  currentPrompt: string,
  examples: PromptImprovementExample[],
): string {
  const exampleText = examples
    .map(
      (example, index) => `Example ${index + 1}
Sentence:
${example.sentenceText}

Baseline note:
${example.baselineNote ?? "(no note)"}

Current regenerated note:
${example.currentNote ?? "(no note)"}

Human gold note:
${example.goldNote}

Comment:
${example.comment ?? "(none)"}`,
    )
    .join("\n\n---\n\n");

  return `You are improving Jeom's final note-generation prompt.

Jeom is a reading assistant for serious readers. The notes are short, anchored
to a specific sentence/phrase, and should reveal hidden context, allusion,
accountability, or reasoning structure without doing generic criticism.

Given the current prompt and human gold notes, infer the missing prompt rule.
Do not overfit to the examples. Do not add a long examples section unless it is
strictly necessary. Prefer a minimal patch that preserves the current prompt's
style and constraints.

Return strict JSON only, with this shape:
{
  "diagnosis": "What the current prompt failed to specify.",
  "patch": "The minimal rule/change to add.",
  "draftPrompt": "The full updated prompt text."
}

Current prompt:
${currentPrompt}

Gold examples:
${exampleText}`;
}

function stripCodeFence(raw: string): string {
  const m = raw.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return m && m[1] ? m[1] : raw;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Prompt improver returned invalid ${field}`);
  }
  return value.trim();
}
