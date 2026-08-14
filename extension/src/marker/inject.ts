/** In-situ marker injection. For each annotated sentence in the article root,
 *  replaces the sentence-end period with a <span class="ra-dot">, attaches
 *  hover handlers wired to the singleton note popover.
 *
 *  M variant: the dot REPLACES the period; any closing quote/paren following
 *  the period survives. (Locked by 2026-05-21 dogfood.)
 */

import type { DOMSentence } from "../lib/segment";
import { mergeFragments, segmentSentencesWithDOM } from "../lib/segment";
import { disposeAllPopovers, scheduleClose, showPopover } from "./note-popover";

import markerCss from "./marker.css?inline";

const STYLE_ELEMENT_ID = "ra-marker-style";
const DOT_CLASS = "ra-dot";
// Matches the closing punctuation patterns the segmenter steps past.
// Keep in sync with CLOSING_PUNCT in extension/src/lib/segment.ts.
const CLOSING_PUNCT_RE = /["'”’)\]]/;

export interface InjectMarkersOpts {
  /** Article root — used only for popover positioning (margin-sticky). */
  root: Element;
  /** Pre-segmented sentences with DOM positions (from segmentSentencesWithDOM). */
  sentences: DOMSentence[];
  /** Notes keyed by `${paragraph}::${sentence}`, matching DOMSentence indices. */
  notes: Record<string, string>;
  /** Keep dots alive if the host page re-renders the annotated subtree. */
  persist?: {
    /** Re-resolve the current article root if the original one is replaced. */
    resolveRoot?: () => Element | null;
    /** Test hook; production uses a short debounce. */
    checkDelayMs?: number;
  };
}

export interface InjectMarkersHandle {
  cleanup: () => void;
  dotsInjected: number;
  skippedNoPeriod: number;
  skippedNoNote: number;
}

let activePersistenceObserver: MutationObserver | null = null;

export function injectMarkers(opts: InjectMarkersOpts): InjectMarkersHandle {
  injectStyles();
  disconnectActivePersistenceObserver();
  restoreExistingDots();

  const result = applyMarkers({
    root: opts.root,
    sentences: opts.sentences,
    notes: opts.notes,
  });

  const persistenceObserver =
    opts.persist !== undefined && result.dotsInjected > 0
      ? observeDotPersistence({
          root: opts.root,
          notes: opts.notes,
          expectedDots: result.dotsInjected,
          resolveRoot: opts.persist.resolveRoot,
          checkDelayMs: opts.persist.checkDelayMs,
        })
      : null;
  activePersistenceObserver = persistenceObserver;

  return {
    cleanup: () => {
      if (activePersistenceObserver === persistenceObserver) {
        disconnectActivePersistenceObserver();
      } else {
        persistenceObserver?.disconnect();
      }
      disposeAllPopovers();
      restoreExistingDots();
      removeStyles();
    },
    ...result,
  };
}

interface ApplyMarkersOpts {
  root: Element;
  sentences: DOMSentence[];
  notes: Record<string, string>;
}

function applyMarkers(opts: ApplyMarkersOpts): Omit<InjectMarkersHandle, "cleanup"> {
  let dotsInjected = 0;
  let skippedNoPeriod = 0;
  let skippedNoNote = 0;

  // Iterate in reverse so DOM edits don't shift earlier sentence offsets.
  // Within a paragraph, multiple sentences may share a text node — splitting
  // at later positions first preserves earlier indices.
  for (let i = opts.sentences.length - 1; i >= 0; i--) {
    const s = opts.sentences[i]!;
    if (s.periodNode === null || s.periodOffset === null) {
      skippedNoPeriod++;
      continue;
    }
    const key = `${s.paragraph}::${s.sentence}`;
    const noteBody = opts.notes[key];
    if (!noteBody) {
      skippedNoNote++;
      continue;
    }
    if (wrapPeriodWithDot(s, noteBody, opts.root)) {
      dotsInjected++;
    }
  }

  return { dotsInjected, skippedNoPeriod, skippedNoNote };
}

interface ObserveDotPersistenceOpts {
  root: Element;
  notes: Record<string, string>;
  expectedDots: number;
  resolveRoot?: () => Element | null;
  checkDelayMs?: number;
}

function observeDotPersistence(opts: ObserveDotPersistenceOpts): MutationObserver {
  let expectedDots = opts.expectedDots;
  let scheduled = false;
  let applying = false;
  let currentRoot = opts.root;
  const target = document.body;

  const observer = new MutationObserver(() => {
    if (applying || scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      if (applying) return;

      const resolvedRoot =
        opts.resolveRoot?.() ?? (currentRoot.isConnected ? currentRoot : null);
      if (resolvedRoot === null) {
        observer.disconnect();
        return;
      }
      currentRoot = resolvedRoot;

      if (currentRoot.querySelectorAll("." + DOT_CLASS).length >= expectedDots) return;

      restoreExistingDots();
      const sentences = mergeFragments(segmentSentencesWithDOM(currentRoot));
      if (sentences.length === 0) return;

      applying = true;
      try {
        disposeAllPopovers();
        const result = applyMarkers({
          root: currentRoot,
          sentences,
          notes: opts.notes,
        });
        if (result.dotsInjected > 0) {
          expectedDots = result.dotsInjected;
        }
      } finally {
        applying = false;
      }
    }, opts.checkDelayMs ?? 80);
  });

  observer.observe(target, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return observer;
}

function disconnectActivePersistenceObserver(): void {
  activePersistenceObserver?.disconnect();
  activePersistenceObserver = null;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ELEMENT_ID;
  styleEl.textContent = markerCss;
  document.head.appendChild(styleEl);
}

function removeStyles(): void {
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
}

export function restoreExistingDots(): void {
  document.querySelectorAll("." + DOT_CLASS).forEach((el) => {
    el.replaceWith(document.createTextNode("."));
  });
}

/** @internal — exported for testing */
export function wrapPeriodWithDot(
  s: DOMSentence,
  noteBody: string,
  root: Element,
): boolean {
  const periodNode = s.periodNode;
  const periodOffset = s.periodOffset;
  if (periodNode === null || periodOffset === null) return false;
  if (!periodNode.parentNode) return false;
  if (periodOffset < 0 || periodOffset >= periodNode.data.length) return false;

  // End offset = period + optionally one closing-punct character (keeps `."`
  // and `?')` from leaving an orphan closer after the dot).
  let endOffset = periodOffset + 1;
  if (
    endOffset < periodNode.data.length &&
    CLOSING_PUNCT_RE.test(periodNode.data[endOffset]!)
  ) {
    endOffset++;
  }
  const hasCloser = endOffset > periodOffset + 1;

  try {
    periodNode.splitText(endOffset); // detach tail; periodNode is now [0..endOffset)
    const punct = periodNode.splitText(periodOffset); // punct = "." or ".'"
    const dot = document.createElement("span");
    dot.className = DOT_CLASS;
    dot.addEventListener("mouseenter", () => {
      showPopover({ dot, body: noteBody, root });
    });
    dot.addEventListener("mouseleave", scheduleClose);
    punct.parentNode?.insertBefore(dot, punct);
    if (hasCloser) {
      punct.data = punct.data.slice(1); // drop period, keep closer (M variant)
    } else {
      punct.remove(); // drop period entirely (M variant)
    }
    return true;
  } catch (err) {
    console.warn("[jeom marker] split failed:", err);
    return false;
  }
}
