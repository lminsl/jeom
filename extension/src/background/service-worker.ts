/** Background service worker.
 *
 * Handles two message types from content scripts:
 *  - ANNOTATE_REQUEST: runs the v7 note-gen prompt via the unified LLM.
 *  - SELECT_ROOT_REQUEST: runs the article-root selector prompt via the
 *    unified LLM, returns the raw selector text.
 *
 * Both API calls live here (not in the content script) so the API key never
 * enters the page-adjacent JS execution context.
 */

import { annotate } from "../lib/api";
import {
  improvePrompt,
  type PromptImprovementExample,
  type PromptImprovementResult,
} from "../lib/prompt-improver";
import {
  callLLMDirect,
  type LLMConfig,
  type SelectRootRequestMsg,
  type SelectRootResponseMsg,
} from "../lib/selector-llm";
import {
  listProviderModels,
  testProviderConnection,
} from "../lib/llm-client";
import { getConfig } from "../lib/storage";
import type { NoteGenTelemetry, SentenceInput } from "../lib/api";

interface AnnotateRequest {
  type: "ANNOTATE_REQUEST";
  title: string;
  sentences: SentenceInput[];
  promptOverride?: string;
}

interface AnnotateResponse {
  ok: boolean;
  notes?: Record<string, string>;
  debug?: Record<string, { why: string | null; interaction: string | null }>;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
  telemetry?: NoteGenTelemetry;
  error?: string;
}

interface ImprovePromptRequest {
  type: "IMPROVE_PROMPT_REQUEST";
  currentPrompt: string;
  examples: PromptImprovementExample[];
}

type ImprovePromptResponse =
  | ({ ok: true } & PromptImprovementResult)
  | { ok: false; error: string };

interface ListProviderModelsRequest {
  type: "LIST_PROVIDER_MODELS_REQUEST";
  llm: LLMConfig;
}

type ListProviderModelsResponse =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

interface TestProviderRequest {
  type: "TEST_PROVIDER_REQUEST";
  llm: LLMConfig;
}

type TestProviderResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

chrome.runtime.onMessage.addListener(
  (msg: AnnotateRequest, _sender, sendResponse) => {
    if (msg?.type !== "ANNOTATE_REQUEST") return false;
    void (async () => {
      try {
        const cfg = await getConfig();
        const result = await annotate({
          llm: cfg.llm,
          title: msg.title,
          sentences: msg.sentences,
          promptOverride: msg.promptOverride,
        });
        const response: AnnotateResponse = {
          ok: true,
          notes: result.notes,
          debug: result.debug,
          usage: result.usage,
          finishReason: result.finishReason,
          telemetry: result.telemetry,
        };
        sendResponse(response);
      } catch (err) {
        const response: AnnotateResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        sendResponse(response);
      }
    })();
    return true; // keep the channel open for the async response
  },
);

chrome.runtime.onMessage.addListener(
  (msg: ImprovePromptRequest, _sender, sendResponse) => {
    if (msg?.type !== "IMPROVE_PROMPT_REQUEST") return false;
    void (async () => {
      try {
        const cfg = await getConfig();
        const result = await improvePrompt({
          llm: cfg.llm,
          currentPrompt: msg.currentPrompt,
          examples: msg.examples,
        });
        const response: ImprovePromptResponse = { ok: true, ...result };
        sendResponse(response);
      } catch (err) {
        const response: ImprovePromptResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        sendResponse(response);
      }
    })();
    return true;
  },
);

chrome.runtime.onMessage.addListener(
  (msg: SelectRootRequestMsg, _sender, sendResponse) => {
    if (msg?.type !== "SELECT_ROOT_REQUEST") return false;
    void (async () => {
      try {
        const cfg = await getConfig();
        const text = await callLLMDirect(cfg.llm, msg.prompt);
        const response: SelectRootResponseMsg = { ok: true, text };
        sendResponse(response);
      } catch (err) {
        const response: SelectRootResponseMsg = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        sendResponse(response);
      }
    })();
    return true; // keep the channel open for the async response
  },
);

chrome.runtime.onMessage.addListener(
  (msg: ListProviderModelsRequest, _sender, sendResponse) => {
    if (msg?.type !== "LIST_PROVIDER_MODELS_REQUEST") return false;
    void (async () => {
      try {
        const models = await listProviderModels(msg.llm);
        const response: ListProviderModelsResponse = { ok: true, models };
        sendResponse(response);
      } catch (err) {
        const response: ListProviderModelsResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        sendResponse(response);
      }
    })();
    return true;
  },
);

chrome.runtime.onMessage.addListener(
  (msg: TestProviderRequest, _sender, sendResponse) => {
    if (msg?.type !== "TEST_PROVIDER_REQUEST") return false;
    void (async () => {
      try {
        const text = await testProviderConnection(msg.llm);
        const response: TestProviderResponse = { ok: true, text };
        sendResponse(response);
      } catch (err) {
        const response: TestProviderResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        sendResponse(response);
      }
    })();
    return true;
  },
);

console.log("[jeom] background service worker ready");
