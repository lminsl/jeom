/** Content script. Runs on every page; activates only on user request
 * (popup → "Annotate this article").
 *
 * Two render paths, gated by storage `renderMode`:
 *   - "reader" (v0): Readability → new annotated overlay that replaces the page.
 *   - "in-situ" (v1, default): selector LLM picks article root → segment in
 *     place → ANNOTATE → marker module injects dots at sentence-end periods.
 */

import { Readability } from "@mozilla/readability";
import {
  mergeFragments,
  segmentSentences,
  segmentSentencesWithDOM,
} from "../lib/segment";
import { renderReader } from "../reader/render";
import { findArticleRoot, removeCacheEntry } from "../lib/selector-llm";
import { injectMarkers, restoreExistingDots } from "../marker/inject";
import { getConfig, type StoredConfig } from "../lib/storage";
import { logSession } from "../lib/telemetry";
import { saveDebugSession } from "../lib/debug-session";
import type { NoteGenTelemetry, SentenceInput } from "../lib/api";

interface ActivateMessage {
  type: "ACTIVATE";
}

interface AnnotateResponse {
  ok: boolean;
  notes?: Record<string, string>;
  telemetry?: NoteGenTelemetry;
  error?: string;
}

const MAX_SENTENCES = 80;

// --- developer-mode trace -------------------------------------------------

let cachedDeveloperMode = false;
void getConfig().then((cfg) => {
  cachedDeveloperMode = cfg.developerMode;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.developerMode) {
    cachedDeveloperMode = changes.developerMode.newValue as boolean;
  }
});

/** Always console.log with the [jeom] prefix. When developer mode is on,
 *  also broadcast a TRACE_LOG so the popup can stream it. */
function traceLog(msg: string): void {
  console.log(`[jeom] ${msg}`);
  if (cachedDeveloperMode) {
    void chrome.runtime
      .sendMessage({ type: "TRACE_LOG", msg })
      .catch(() => {
        // popup not open — fire-and-forget
      });
  }
}

chrome.runtime.onMessage.addListener(
  (msg: ActivateMessage, _sender, sendResponse) => {
    if (msg?.type !== "ACTIVATE") return false;
    void (async () => {
      try {
        await activate();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  },
);

async function activate(): Promise<void> {
  const cfg = await getConfig();
  if (cfg.renderMode === "in-situ") {
    await activateInSitu(cfg);
  } else {
    await activateReader(cfg);
  }
}

// --- in-situ path (v1) -----------------------------------------------------

async function activateInSitu(cfg: StoredConfig): Promise<void> {
  if (!cfg.llm.apiKey) {
    throw new Error(
      "in-situ mode needs an LLM API key. Set one in the extension Options page.",
    );
  }

  traceLog("in-situ: selector LLM call…");
  const sel = await findArticleRoot({
    document,
    url: location.href,
    llm: cfg.llm,
  });
  if (sel.kind === "not-an-article") {
    throw new Error(
      `Selector LLM returned no article root (${sel.reason}). This page may not be an article.`,
    );
  }
  const root = sel.roots[0]!;
  traceLog(
    `in-situ: article root = "${sel.selector}" (source=${sel.source}, ${sel.roots.length} match)`,
  );

  restoreExistingDots();
  const domSentences = mergeFragments(segmentSentencesWithDOM(root));
  if (domSentences.length < 5) {
    // The cached selector (if any) won't work for this page's markup. Drop
    // it so a future visit re-runs the LLM rather than re-failing instantly.
    await removeCacheEntry(location.href, cfg.llm);
    const reason =
      sel.source === "heuristic-fallback"
        ? `heuristic fallback root "${sel.selector}" has no paragraph markup`
        : `${sel.source === "cache" ? "cached " : ""}LLM-picked root "${sel.selector}" has no paragraph markup inside (page may use <td>-based layout — e.g. Paul Graham essays — or JS-rendered content that hadn't loaded yet)`;
    throw new Error(
      `In-situ found ${domSentences.length} annotatable sentences — ${reason}.`,
    );
  }

  const truncated = domSentences.length > MAX_SENTENCES;
  const capped = truncated ? domSentences.slice(0, MAX_SENTENCES) : domSentences;
  if (truncated) {
    traceLog(
      `in-situ: truncating ${domSentences.length} → ${MAX_SENTENCES} sentences for annotation`,
    );
  }

  const sentencesForAPI: SentenceInput[] = capped.map((s) => ({
    paragraphIndex: s.paragraph,
    sentenceIndex: s.sentence,
    text: s.text,
  }));

  traceLog(
    `in-situ: ANNOTATE_REQUEST (${sentencesForAPI.length} sentences)…`,
  );
  const response = (await chrome.runtime.sendMessage({
    type: "ANNOTATE_REQUEST",
    title: document.title,
    sentences: sentencesForAPI,
  })) as AnnotateResponse | undefined;
  if (!response || !response.ok) {
    throw new Error(response?.error ?? "ANNOTATE_REQUEST failed");
  }
  const notes: Record<string, string> = response.notes ?? {};
  traceLog(
    `in-situ: notes received (${Object.keys(notes).length} of ${sentencesForAPI.length})`,
  );

  const handle = injectMarkers({
    root,
    sentences: capped,
    notes,
    persist: {
      resolveRoot: () => document.querySelector(sel.selector),
    },
  });
  traceLog(
    `in-situ: dotsInjected=${handle.dotsInjected}, skippedNoPeriod=${handle.skippedNoPeriod}, skippedNoNote=${handle.skippedNoNote}`,
  );
  if (handle.dotsInjected === 0) {
    throw new Error(
      "No dots were injected. The selected root may have no sentence-terminal periods, or notes did not match any sentence indices.",
    );
  }

  if (cfg.developerMode && response.telemetry) {
    void saveDebugSession({
      url: location.href,
      title: document.title,
      llm: cfg.llm,
      sentences: sentencesForAPI,
      annotation: { notes, telemetry: response.telemetry },
    });
  }

  if (cfg.shareDogfoodTelemetry) {
    void logSession({
      url: location.href,
      title: document.title,
      extVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      llm: cfg.llm,
      selectorStep: sel.telemetry,
      noteGenStep: response.telemetry,
      renderStep: handle,
    });
  }
}

// --- reader path (v0, preserved) -------------------------------------------

async function activateReader(cfg: StoredConfig): Promise<void> {
  const docClone = document.cloneNode(true) as Document;
  const article = new Readability(docClone).parse();
  if (!article || !article.content) {
    throw new Error(
      "Readability could not extract an article from this page. Try on a longer article (blog post, news piece, encyclopedia entry).",
    );
  }

  const articleEl = document.createElement("div");
  articleEl.innerHTML = article.content;
  const rawParagraphs = Array.from(
    articleEl.querySelectorAll("p, li, blockquote"),
  )
    .map((el) => (el.textContent ?? "").trim())
    .filter((t) => t.length > 0);

  interface Para {
    index: number;
    sentences: { index: number; text: string }[];
  }
  const paragraphs: Para[] = [];
  const flatSentences: SentenceInput[] = [];
  for (let pi = 0; pi < rawParagraphs.length; pi++) {
    const text = rawParagraphs[pi]!;
    const sents = segmentSentences(text);
    if (sents.length === 0) continue;
    paragraphs.push({
      index: pi,
      sentences: sents.map((s, si) => ({ index: si, text: s })),
    });
    for (let si = 0; si < sents.length; si++) {
      flatSentences.push({
        paragraphIndex: pi,
        sentenceIndex: si,
        text: sents[si]!,
      });
    }
  }

  if (flatSentences.length < 5) {
    throw new Error(
      `Article too short to annotate (${flatSentences.length} sentences). Need at least 5.`,
    );
  }

  const truncated = flatSentences.length > MAX_SENTENCES;
  const sentencesForAPI = truncated
    ? flatSentences.slice(0, MAX_SENTENCES)
    : flatSentences;
  if (truncated) {
    traceLog(
      `reader: truncating ${flatSentences.length} -> ${MAX_SENTENCES} for annotation`,
    );
  }

  const loaderId = renderReader({
    title: article.title || document.title,
    paragraphs,
    notes: {},
    debug: {},
    loading: true,
  });

  const response = await chrome.runtime.sendMessage({
    type: "ANNOTATE_REQUEST",
    title: article.title || document.title,
    sentences: sentencesForAPI,
  });

  if (!response || !response.ok) {
    renderReader({
      title: article.title || document.title,
      paragraphs,
      notes: {},
      debug: {},
      error: response?.error ?? "Unknown error",
      loading: false,
      replaceId: loaderId,
    });
    return;
  }

  if (cfg.developerMode && response.telemetry) {
    void saveDebugSession({
      url: location.href,
      title: article.title || document.title,
      llm: cfg.llm,
      sentences: sentencesForAPI,
      annotation: {
        notes: response.notes ?? {},
        telemetry: response.telemetry,
      },
    });
  }

  renderReader({
    title: article.title || document.title,
    paragraphs,
    notes: response.notes ?? {},
    debug: response.debug ?? {},
    usage: response.usage,
    truncatedAt: truncated ? MAX_SENTENCES : undefined,
    totalSentences: flatSentences.length,
    loading: false,
    replaceId: loaderId,
  });
}

traceLog(`content script ready on ${location.href}`);
