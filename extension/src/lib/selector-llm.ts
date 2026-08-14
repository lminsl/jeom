/** Selector LLM — picks the article root via LLM, with cache + heuristic
 *  fallback. Compartmentalized from the note-gen call.
 *
 *  Contract: given the live document + URL + LLM config, returns either a
 *  list of live-DOM element(s) representing the article body (`kind:
 *  "found"`) or a refusal (`kind: "not-an-article"`). Caller never has to
 *  handle null / undefined.
 *
 *  Cache: (url, provider:model) → selector string. Switching model triggers
 *  a fresh call; same model on same URL hits cache. Heuristic-fallback
 *  results are NOT cached (so next visit retries the LLM).
 */

import {
  callAnthropic,
  callAnthropicFoundry,
  type AnthropicModelName,
} from "./anthropic-client";
import { callOpenAI, type OpenAIModelName } from "./openai-client";

export type LLMConfig =
  | { provider: "anthropic"; model: AnthropicModelName; apiKey: string }
  | {
      provider: "anthropic-foundry";
      /** Deployment name as configured in Azure AI Foundry. */
      model: string;
      apiKey: string;
      /** Full URL, e.g. https://<resource>.services.ai.azure.com/anthropic/v1/messages */
      endpoint: string;
    }
  | { provider: "openai"; model: OpenAIModelName; apiKey: string };

export type SelectorSource = "llm" | "cache" | "heuristic-fallback";

export interface SelectorTelemetry {
  prompt: string;
  rawResponse: string;
  parsedSelector: string;
  kind: SelectorResult["kind"];
  source: SelectorSource | "none";
  latencyMs: number;
  errorClass: string | null;
}

export type SelectorResult =
  | {
      kind: "found";
      roots: Element[];
      selector: string;
      source: SelectorSource;
      telemetry?: SelectorTelemetry;
    }
  | {
      kind: "not-an-article";
      reason: "llm-refused" | "heuristic-empty";
      telemetry?: SelectorTelemetry;
    };

export interface FindArticleRootOpts {
  document: Document;
  url: string;
  llm: LLMConfig;
}

// --- DOM outline -----------------------------------------------------------

const OUTLINE_SKIP_TAGS = new Set([
  "script", "style", "svg", "noscript", "link", "meta", "path", "g", "use",
]);
const OUTLINE_MAX_LINES = 220;
const OUTLINE_MAX_DEPTH = 7;
const OUTLINE_PREVIEW_CHARS = 70;

export function buildDomOutline(root: Element): string {
  const lines: string[] = [];

  const visit = (el: Element, depth: number): void => {
    if (depth > OUTLINE_MAX_DEPTH || lines.length > OUTLINE_MAX_LINES) return;
    const tag = el.tagName.toLowerCase();
    if (OUTLINE_SKIP_TAGS.has(tag)) return;
    const id = el.id ? "#" + el.id : "";
    const cls = el.classList.length
      ? "." + Array.from(el.classList).slice(0, 3).join(".")
      : "";
    const role = el.getAttribute("role");
    const roleStr = role ? `[role=${role}]` : "";
    // innerText is layout-dependent (excellent in real browsers, "" in jsdom);
    // fall back to textContent so tests + edge contexts still get a signal.
    const text = ((el as HTMLElement).innerText || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const charCount = text.length;
    const pCount = el.querySelectorAll("p").length;
    const preview =
      text.length > OUTLINE_PREVIEW_CHARS
        ? text.slice(0, OUTLINE_PREVIEW_CHARS) + "…"
        : text;
    const indent = "  ".repeat(depth);
    lines.push(
      `${indent}<${tag}${id}${cls}${roleStr}> chars=${charCount} p=${pCount} | "${preview}"`,
    );
    for (const child of Array.from(el.children)) {
      if (lines.length > OUTLINE_MAX_LINES) break;
      visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return lines.join("\n");
}

// --- Prompt ----------------------------------------------------------------

const SELECTOR_PROMPT_HEADER = `You are looking at a DOM-outline of a web page. Each line shows: indent depth, tag, id, classes, role, innerText character count, descendant <p> count, and the first 70 chars of innerText.

Your task: output ONE CSS selector that identifies the live DOM element that contains the article's main body content. The selector must be precise enough to uniquely target that element on the live page.

CONSTRAINTS:
- Output ONLY the CSS selector. No explanation. No quotes. No markdown. No prose.
- Prefer selectors using id or class (e.g. article.post, main#content, div.story-body). Avoid > chains longer than 3 deep.
- The article body is typically the element with the highest p-count of substantive text, NOT navigation, comments, related-articles, or page chrome.
- If the page has no readable article (404, listing page, login wall, homepage, aggregator), output: NONE
- WHEN IN DOUBT — for example, a page that uses an unfamiliar template (academic blog, distill-style, custom CMS) but contains a clear text body — prefer the densest paragraph container over NONE. Only return NONE when there is genuinely no main body text.

DOM outline:
`;

function buildSelectorPrompt(domOutline: string): string {
  return SELECTOR_PROMPT_HEADER + domOutline;
}

// --- LLM dispatch ----------------------------------------------------------

/** @internal — exported for testing */
export function modelKey(llm: LLMConfig): string {
  return `${llm.provider}:${llm.model}`;
}

export interface CallLLMDirectOpts {
  maxTokens?: number;
}

/** Worker-side: the actual fetch happens here. Content script must NOT call
 *  this directly — see callLLMViaWorker. Keeping the API key out of the
 *  content-script execution context is the reason for the worker indirection. */
export async function callLLMDirect(
  llm: LLMConfig,
  prompt: string,
  opts: CallLLMDirectOpts = {},
): Promise<string> {
  const { maxTokens } = opts;
  if (llm.provider === "anthropic") {
    return callAnthropic({ prompt, model: llm.model, apiKey: llm.apiKey, maxTokens });
  }
  if (llm.provider === "anthropic-foundry") {
    return callAnthropicFoundry({
      prompt,
      deployment: llm.model,
      apiKey: llm.apiKey,
      endpoint: llm.endpoint,
      maxTokens,
    });
  }
  if (llm.provider === "openai") {
    return callOpenAI({ prompt, model: llm.model, apiKey: llm.apiKey, maxTokens });
  }
  const _exhaustive: never = llm;
  throw new Error(`Unknown LLM provider: ${JSON.stringify(_exhaustive)}`);
}

// --- Worker message protocol -----------------------------------------------

export interface SelectRootRequestMsg {
  type: "SELECT_ROOT_REQUEST";
  prompt: string;
  llm: LLMConfig;
}

export type SelectRootResponseMsg =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** Content-side: send the prompt to the background service worker, which
 *  performs the actual fetch with the API key. Keeps the key out of the
 *  page-adjacent JS context. */
async function callLLMViaWorker(
  llm: LLMConfig,
  prompt: string,
): Promise<string> {
  const req: SelectRootRequestMsg = { type: "SELECT_ROOT_REQUEST", prompt, llm };
  const resp = (await chrome.runtime.sendMessage(req)) as
    | SelectRootResponseMsg
    | undefined;
  if (!resp) {
    throw new Error(
      "[selector-llm] no response from background worker (handler not registered?)",
    );
  }
  if (!resp.ok) {
    throw new Error(resp.error);
  }
  return resp.text;
}

// --- Selector parsing ------------------------------------------------------

/** @internal — exported for testing. Strips surrounding whitespace, backticks,
 *  and quotes that some models add despite "no markdown, no quotes". */
export function normalizeSelectorResponse(raw: string): string {
  return raw
    .trim()
    .replace(/^[`"']+/, "")
    .replace(/[`"']+$/, "")
    .trim();
}

/** @internal — exported for testing. Invalid CSS yields [] instead of a throw. */
export function safeQuerySelectorAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

// --- Cache (chrome.storage.local) ------------------------------------------

interface CachedSelector {
  selector: string; // CSS selector or "NONE"
}

type SelectorCacheByModel = Record<string, CachedSelector>;
type SelectorCache = Record<string, SelectorCacheByModel>;

const CACHE_KEY = "selectorCache";

async function readCache(): Promise<SelectorCache> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY];
  return (cache as SelectorCache | undefined) ?? {};
}

async function writeCacheEntry(
  url: string,
  key: string,
  entry: CachedSelector,
): Promise<void> {
  const cache = await readCache();
  const perUrl = cache[url] ?? {};
  perUrl[key] = entry;
  cache[url] = perUrl;
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

export async function clearSelectorCache(): Promise<void> {
  await chrome.storage.local.remove(CACHE_KEY);
}

/** Drop the cached selector for one (url, llm) pair so the next visit
 *  re-runs the LLM. Useful when the caller discovers the cached selector
 *  was wrong for downstream processing (e.g. segmenter found 0 sentences
 *  inside it) and we don't want to keep serving the bad selector. */
export async function removeCacheEntry(url: string, llm: LLMConfig): Promise<void> {
  const cache = await readCache();
  const mkey = modelKey(llm);
  const perUrl = cache[url];
  if (!perUrl) return;
  delete perUrl[mkey];
  if (Object.keys(perUrl).length === 0) {
    delete cache[url];
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

// --- Heuristic fallback ----------------------------------------------------

const HEURISTIC_CANDIDATES: ReadonlyArray<{ selector: string }> = [
  { selector: "article" },
  { selector: "main" },
  { selector: '[role="main"]' },
];

/** @internal — exported for testing */
export function heuristicFallback(doc: Document): SelectorResult {
  for (const { selector } of HEURISTIC_CANDIDATES) {
    const el = doc.querySelector(selector);
    if (el) {
      return {
        kind: "found",
        roots: [el],
        selector,
        source: "heuristic-fallback",
      };
    }
  }
  // Largest-text fallback. Sentinel selector — not re-applicable; debug only.
  let best: Element | null = null;
  let bestLen = 0;
  for (const el of Array.from(doc.querySelectorAll("div, section"))) {
    const len = ((el as HTMLElement).innerText || el.textContent || "").length;
    if (len > bestLen && len > 200) {
      best = el;
      bestLen = len;
    }
  }
  if (best) {
    return {
      kind: "found",
      roots: [best],
      selector: "<heuristic:largest-text>",
      source: "heuristic-fallback",
    };
  }
  return { kind: "not-an-article", reason: "heuristic-empty" };
}

// --- Public API ------------------------------------------------------------

export async function findArticleRoot(
  opts: FindArticleRootOpts,
): Promise<SelectorResult> {
  const { document: doc, url, llm } = opts;
  const mkey = modelKey(llm);

  // Cache read disabled — every ACTIVATE goes through to the LLM. Removes
  // a state-management variable while we're tuning the selector prompt.
  // Cache writes below still happen, so re-enabling is a one-line revert.

  // 2. LLM call via worker. On any failure, fall back to heuristic.
  let raw: string;
  const outline = buildDomOutline(doc.body);
  const prompt = buildSelectorPrompt(outline);
  const start = performance.now();
  try {
    raw = await callLLMViaWorker(llm, prompt);
  } catch (err) {
    console.warn(
      "[selector-llm] LLM call failed; falling back to heuristic:",
      err,
    );
    const fallback = heuristicFallback(doc);
    return withSelectorTelemetry(fallback, {
      prompt,
      rawResponse: "",
      parsedSelector: "",
      kind: fallback.kind,
      source: fallback.kind === "found" ? fallback.source : "none",
      latencyMs: elapsedMs(start),
      errorClass: errorClass(err),
    });
  }

  const selector = normalizeSelectorResponse(raw);

  // 3. Handle NONE / empty. Some models are over-conservative on custom
  // blog templates; if the deterministic fallback can find a semantic root,
  // keep going rather than failing the page outright.
  if (selector === "NONE" || selector === "") {
    const fallback = heuristicFallback(doc);
    if (fallback.kind === "found") {
      return withSelectorTelemetry(fallback, {
        prompt,
        rawResponse: raw,
        parsedSelector: selector,
        kind: "found",
        source: fallback.source,
        latencyMs: elapsedMs(start),
        errorClass: null,
      });
    }
    await writeCacheEntry(url, mkey, { selector: "NONE" });
    return {
      kind: "not-an-article",
      reason: "llm-refused",
      telemetry: {
        prompt,
        rawResponse: raw,
        parsedSelector: selector,
        kind: "not-an-article",
        source: "none",
        latencyMs: elapsedMs(start),
        errorClass: null,
      },
    };
  }

  // 4. Validate against live DOM.
  const roots = safeQuerySelectorAll(doc, selector);
  if (roots.length === 0) {
    console.warn(
      `[selector-llm] LLM selector "${selector}" matched 0 elements; falling back to heuristic`,
    );
    const fallback = heuristicFallback(doc);
    return withSelectorTelemetry(fallback, {
      prompt,
      rawResponse: raw,
      parsedSelector: selector,
      kind: fallback.kind,
      source: fallback.kind === "found" ? fallback.source : "none",
      latencyMs: elapsedMs(start),
      errorClass: null,
    });
  }

  // 5. Cache + return.
  await writeCacheEntry(url, mkey, { selector });
  return {
    kind: "found",
    roots,
    selector,
    source: "llm",
    telemetry: {
      prompt,
      rawResponse: raw,
      parsedSelector: selector,
      kind: "found",
      source: "llm",
      latencyMs: elapsedMs(start),
      errorClass: null,
    },
  };
}

function withSelectorTelemetry<T extends SelectorResult>(
  result: T,
  telemetry: SelectorTelemetry,
): T {
  return { ...result, telemetry };
}

function elapsedMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function errorClass(err: unknown): string {
  return err instanceof Error ? err.name || "Error" : typeof err;
}
