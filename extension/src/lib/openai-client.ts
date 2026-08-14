/** Thin OpenAI Chat-Completions wrapper. Single-shot prompt → text response.
 *  Separate from `api.ts` (which is bound to the v7 note-gen JSON schema);
 *  this one is for short-form selector calls.
 */

export type OpenAIModelName = "gpt-5" | "gpt-5-mini";

const MODEL_IDS: Record<OpenAIModelName, string> = {
  "gpt-5": "gpt-5",
  "gpt-5-mini": "gpt-5-mini",
};

const API_URL = "https://api.openai.com/v1/chat/completions";

export interface CallOpenAIOpts {
  prompt: string;
  model: OpenAIModelName;
  apiKey: string;
  maxTokens?: number;
}

export async function callOpenAI(opts: CallOpenAIOpts): Promise<string> {
  if (!opts.apiKey) {
    throw new Error("No OpenAI API key. Set one in the extension Options page.");
  }
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_IDS[opts.model],
      max_completion_tokens: opts.maxTokens ?? 256,
      // No reasoning_effort: selector calls are short-form and don't need
      // reasoning tokens. Add it as an option if quality regresses.
      messages: [{ role: "user", content: opts.prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const data: unknown = await resp.json();
  const text = extractText(data);
  if (text === null) {
    throw new Error("OpenAI returned no text content");
  }
  return text;
}

function extractText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}
