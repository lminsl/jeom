/** Runs the v7 note-gen prompt through the unified LLM dispatcher. The
 *  provider/model is whatever the user picked in Options — same LLM as the
 *  selector call. */

import { callLLMDirect, type LLMConfig } from "./selector-llm";
import V7_PROMPT from "./v7_prompt.md?raw";

export const DEFAULT_NOTE_PROMPT = V7_PROMPT;

export interface DebugInfo {
  why: string | null;
  interaction: string | null;
}

export interface SentenceInput {
  paragraphIndex: number;
  sentenceIndex: number;
  text: string;
}

export interface AnnotationResult {
  /** key = `${paragraphIndex}::${sentenceIndex}` */
  notes: Record<string, string>;
  /** key = same; debug includes every sentence */
  debug: Record<string, DebugInfo>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: string;
  telemetry: NoteGenTelemetry;
}

export interface NoteGenTelemetry {
  sentenceCount: number;
  promptTemplate: string;
  prompt: string;
  rawResponse: string;
  noteCount: number;
  latencyMs: number;
  errorClass: string | null;
}

export interface AnnotateOptions {
  llm: LLMConfig;
  title: string;
  sentences: SentenceInput[];
  promptOverride?: string;
}

interface RawSentence {
  global_index: number;
  note?: string | null;
  why?: string | null;
  interaction?: string | null;
}

/** P1.17 regression mitigation: Anthropic models occasionally wrap their
 *  JSON output in ```json ... ``` despite a strict-JSON system prompt. The
 *  old OpenAI-only path used response_format=json_object as a hard guard;
 *  the unified dispatcher has no such guarantee, so strip the fence here. */
function stripCodeFence(raw: string): string {
  const m = raw.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return m && m[1] ? m[1] : raw;
}

export async function annotate(
  opts: AnnotateOptions,
): Promise<AnnotationResult> {
  const flat = opts.sentences.map((s, g) => ({ g, ...s }));
  const body = flat
    .map((x) => `[${x.g}] ${x.text}`)
    .join("\n");
  const userMsg = `Article title: ${opts.title}\n\nSentences (numbered by global index):\n${body}`;
  const promptTemplate = opts.promptOverride?.trim() || DEFAULT_NOTE_PROMPT;
  const prompt = `${promptTemplate}\n\n${userMsg}`;

  const start = performance.now();
  const rawContent = await callLLMDirect(opts.llm, prompt, { maxTokens: 20000 });
  const latencyMs = Math.max(0, Math.round(performance.now() - start));
  if (!rawContent) {
    throw new Error("LLM returned empty response");
  }
  const parsed = JSON.parse(stripCodeFence(rawContent));
  const sentences: RawSentence[] = parsed.sentences ?? [];

  const byG = new Map<number, RawSentence>();
  for (const item of sentences) byG.set(item.global_index, item);

  const notes: Record<string, string> = {};
  const debug: Record<string, DebugInfo> = {};
  for (const x of flat) {
    const item = byG.get(x.g);
    const k = `${x.paragraphIndex}::${x.sentenceIndex}`;
    const note = item?.note?.trim();
    if (note) notes[k] = note;
    debug[k] = {
      why: item?.why?.trim() ?? null,
      interaction: item?.interaction?.trim() ?? null,
    };
  }

  return {
    notes,
    debug,
    usage: { inputTokens: 0, outputTokens: 0 },
    finishReason: "",
    telemetry: {
      sentenceCount: flat.length,
      promptTemplate,
      prompt,
      rawResponse: rawContent,
      noteCount: Object.keys(notes).length,
      latencyMs,
      errorClass: null,
    },
  };
}
