/** Sentence segmentation — scrappy "all the dots" approach.
 *
 * Rule: any `.`/`!`/`?`/`다`/`요` followed by whitespace or end-of-text is a
 * sentence boundary. Optionally step past one closing-quote/paren first so
 * patterns like `."` or `?')` still terminate.
 *
 * Boundary detection protects common abbreviations (`Dr.`, `Sen.`, `e.g.`)
 * and initials before they become sentence candidates. `mergeFragments()`
 * remains as a defensive second pass for cases this guard misses.
 *
 * The "must be followed by whitespace" rule is what protects decimals (`1.5`),
 * URLs (`example.com`), version numbers (`v1.2.3`), and file extensions from
 * splitting inside.
 *
 * Two surfaces:
 *   segmentSentences(text)         — text-only (v0 reader-mode path).
 *   segmentSentencesWithDOM(root)  — walks live DOM, returns each sentence's
 *                                    period node + offset for in-place marker
 *                                    injection (P1).
 *
 * Both share findSentenceBoundaries so the splitting rules can't drift.
 */

// Closing punctuation that can sit between a terminator and whitespace.
// ASCII " ' ) ]  +  curly right double "  +  curly right single '
const CLOSING_PUNCT = /["'”’)\]]/;

type Boundary = {
  /** Index of the terminator char (`.`/`!`/`?`/`다`/`요`) — for DOM marker injection. */
  terminator: number;
  /** Index just past the sentence in `text` (terminator + any trailing closing quote/paren). For slicing. */
  end: number;
};

/** Abbreviations whose periods are treated as internal even before capitals. */
const ALWAYS_PROTECTED_ABBREVIATIONS = new Set([
  // Titles (civilian)
  "Mr.", "Mrs.", "Ms.", "Mx.", "Dr.", "Prof.", "Sr.", "Jr.", "St.", "Hon.", "Rev.",
  // Titles (military / professional)
  "Capt.", "Lt.", "Sgt.", "Cmdr.", "Col.", "Maj.", "Gen.", "Adm.", "Pvt.",
  "Pres.", "Gov.", "Sen.", "Rep.",
  // Latin-derived prose abbreviations
  "vs.", "e.g.", "i.e.", "cf.", "viz.",
  // Corporate
  "Inc.", "Ltd.", "Corp.", "Co.",
  // Months (followed by a date)
  "Jan.", "Feb.", "Mar.", "Apr.", "Jun.", "Jul.",
  "Aug.", "Sep.", "Sept.", "Oct.", "Nov.", "Dec.",
  // Footnote / reference markers
  "p.", "pp.", "ch.", "fig.", "ed.",
]);

/** Abbreviations protected only when the next token starts lowercase. */
const LOWERCASE_CONTINUATION_ABBREVIATIONS = new Set([
  "etc.", "approx.",
  "U.S.", "U.K.", "U.N.", "E.U.",
  "Vol.", "No.",
]);

/** Single capital letter + period — middle initials like J., R., R. */
const SINGLE_INITIAL = /^[A-Z]\.$/;

/** Dotted acronyms / initialisms such as A.I., U.S.A., or Ph.D. */
const DOTTED_ACRONYM = /^(?:[A-Za-z]+\.){2,}$/;

function tokenEndingAt(text: string, periodIndex: number): string {
  let start = periodIndex;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  return text.slice(start, periodIndex + 1);
}

function dottedTokenEndingAt(text: string, periodIndex: number): string {
  let start = periodIndex;
  while (start > 0) {
    const prev = text[start - 1]!;
    if (!/[A-Za-z.]/.test(prev)) break;
    start--;
  }
  return text.slice(start, periodIndex + 1);
}

function startsLowercaseAfterWhitespace(text: string, index: number): boolean {
  let i = index;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return /^[a-z]/.test(text.slice(i, i + 1));
}

function isProtectedAbbreviationBoundary(
  text: string,
  periodIndex: number,
  afterBoundaryIndex: number,
): boolean {
  const token = tokenEndingAt(text, periodIndex);
  if (ALWAYS_PROTECTED_ABBREVIATIONS.has(token)) return true;
  if (SINGLE_INITIAL.test(token)) return true;
  if (DOTTED_ACRONYM.test(dottedTokenEndingAt(text, periodIndex))) {
    return startsLowercaseAfterWhitespace(text, afterBoundaryIndex);
  }
  if (LOWERCASE_CONTINUATION_ABBREVIATIONS.has(token)) {
    return startsLowercaseAfterWhitespace(text, afterBoundaryIndex);
  }
  return false;
}

/** Find every sentence boundary in `text`. Operates on the input as-is — no
 *  whitespace normalization — so indices are valid for downstream DOM lookup. */
function findSentenceBoundaries(text: string): Boundary[] {
  const out: Boundary[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?" && c !== "다" && c !== "요") continue;

    if (i + 1 >= text.length) {
      out.push({ terminator: i, end: i + 1 });
      continue;
    }

    let probe = i + 1;
    const next = text[probe];
    if (next !== undefined && CLOSING_PUNCT.test(next)) probe++;
    const afterMaybeQuote = text[probe];

    if (afterMaybeQuote === undefined) {
      if (c === "." && isProtectedAbbreviationBoundary(text, i, probe)) continue;
      out.push({ terminator: i, end: probe });
      continue;
    }
    if (!/\s/.test(afterMaybeQuote)) continue;

    if (c === "." && isProtectedAbbreviationBoundary(text, i, probe)) continue;
    out.push({ terminator: i, end: probe });
  }
  return out;
}

export function segmentSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const boundaries = findSentenceBoundaries(cleaned);
  const out: string[] = [];
  let start = 0;
  for (const b of boundaries) {
    const sentence = cleaned.slice(start, b.end).trim();
    if (sentence) out.push(sentence);
    start = b.end;
  }
  const trailing = cleaned.slice(start).trim();
  if (trailing) out.push(trailing);
  return out;
}

/** Resolve sorted-ascending character offsets within `element` to (text node,
 *  offset) pairs. Ported from Hypothesis client (MIT) — see
 *  https://github.com/hypothesis/client/blob/73110ff/src/annotator/anchoring/text-range.ts#L40-L79
 *  Walks text nodes in document order with a flat-text accumulator, which
 *  transparently handles sentences split across `<em>`/`<a>`/etc. and remains
 *  valid even after a Text node is split by injected markers. */
function resolveOffsets(
  element: Element,
  ...offsets: number[]
): Array<{ node: Text; offset: number }> {
  const queue = [...offsets];
  let nextOffset = queue.shift();
  const nodeIter = element.ownerDocument.createNodeIterator(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const results: Array<{ node: Text; offset: number }> = [];

  let currentNode = nodeIter.nextNode() as Text | null;
  let textNode: Text | undefined;
  let length = 0;

  while (nextOffset !== undefined && currentNode) {
    textNode = currentNode;
    if (length + textNode.data.length > nextOffset) {
      results.push({ node: textNode, offset: nextOffset - length });
      nextOffset = queue.shift();
    } else {
      currentNode = nodeIter.nextNode() as Text | null;
      length += textNode.data.length;
    }
  }

  while (nextOffset !== undefined && textNode && length === nextOffset) {
    results.push({ node: textNode, offset: textNode.data.length });
    nextOffset = queue.shift();
  }

  if (nextOffset !== undefined) {
    throw new RangeError("Offset exceeds text length");
  }

  return results;
}

export type DOMSentence = {
  paragraph: number;
  sentence: number;
  text: string;
  periodNode: Text | null;
  periodOffset: number | null;
};

const PARAGRAPH_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6";

function findParagraphElements(root: Element): Element[] {
  if (root.matches(PARAGRAPH_SELECTOR)) return [root];
  const matches = Array.from(root.querySelectorAll(PARAGRAPH_SELECTOR));
  return matches.filter((el) => !el.querySelector(PARAGRAPH_SELECTOR));
}

/** Walk paragraph-like elements within `root` and return one record per
 *  sentence with the DOM position of its terminating punctuation. Sentences
 *  that lack terminal punctuation (typically the last sentence of a paragraph
 *  in casually-written articles) get `periodNode: null, periodOffset: null`. */
export function segmentSentencesWithDOM(root: Element): DOMSentence[] {
  const out: DOMSentence[] = [];
  const paragraphs = findParagraphElements(root);

  for (let p = 0; p < paragraphs.length; p++) {
    const el = paragraphs[p]!;
    const text = el.textContent ?? "";
    if (!text.trim()) continue;

    const boundaries = findSentenceBoundaries(text);
    const positions =
      boundaries.length > 0
        ? resolveOffsets(el, ...boundaries.map((b) => b.terminator))
        : [];

    let sentenceIdx = 0;
    let start = 0;
    for (let s = 0; s < boundaries.length; s++) {
      const b = boundaries[s]!;
      const pos = positions[s]!;
      const sentenceText = text.slice(start, b.end).trim();
      if (sentenceText) {
        out.push({
          paragraph: p,
          sentence: sentenceIdx++,
          text: sentenceText,
          periodNode: pos.node,
          periodOffset: pos.offset,
        });
      }
      start = b.end;
    }

    const trailing = text.slice(start).trim();
    if (trailing) {
      out.push({
        paragraph: p,
        sentence: sentenceIdx++,
        text: trailing,
        periodNode: null,
        periodOffset: null,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Phase 1.5 — merge pass                                                     */
/* -------------------------------------------------------------------------- */

function lastToken(text: string): string {
  const trimmed = text.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  return lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1);
}

function shouldMergeWithNext(buffer: string, next: string): boolean {
  if (!buffer.trim().endsWith(".")) return false;
  if (!next.trim()) return false;

  const lastTok = lastToken(buffer);
  const nextStartsLower = /^[a-z]/.test(next.trim());

  // These abbreviations are treated as internal periods even before capitals.
  if (ALWAYS_PROTECTED_ABBREVIATIONS.has(lastTok)) return true;

  // Single-letter initials always merge (they are by definition not sentence ends).
  if (SINGLE_INITIAL.test(lastTok)) return true;

  // Ambiguous abbreviations merge only on a clear lowercase continuation.
  if (LOWERCASE_CONTINUATION_ABBREVIATIONS.has(lastTok) && nextStartsLower) {
    return true;
  }

  // Generic safety: very short fragment + lowercase next.
  if (buffer.trim().length <= 4 && nextStartsLower) return true;

  return false;
}

/** Collapse over-indexed fragments produced by the scrappy splitter back into
 *  coherent sentences. The merged sentence's periodNode/periodOffset point to
 *  the FINAL period (the real sentence end); intermediate abbreviation periods
 *  are not exposed as marker positions.
 *
 *  See TODO.md "P1.1 → Known issues → Over-indexing" for the design rationale
 *  and concrete cases this resolves. */
export function mergeFragments(sentences: DOMSentence[]): DOMSentence[] {
  if (sentences.length === 0) return [];

  const out: DOMSentence[] = [];
  let buffer: DOMSentence | null = null;

  for (const current of sentences) {
    if (buffer === null) {
      buffer = { ...current };
      continue;
    }
    // Never merge across paragraphs.
    if (buffer.paragraph !== current.paragraph) {
      out.push(buffer);
      buffer = { ...current };
      continue;
    }
    if (shouldMergeWithNext(buffer.text, current.text)) {
      buffer = {
        paragraph: buffer.paragraph,
        sentence: buffer.sentence,
        text: buffer.text + " " + current.text,
        periodNode: current.periodNode,
        periodOffset: current.periodOffset,
      };
    } else {
      out.push(buffer);
      buffer = { ...current };
    }
  }
  if (buffer !== null) out.push(buffer);

  // Renumber sentence indices within each paragraph after merging.
  let prevPara = -1;
  let sIdx = 0;
  for (const s of out) {
    if (s.paragraph !== prevPara) {
      sIdx = 0;
      prevPara = s.paragraph;
    }
    s.sentence = sIdx++;
  }

  return out;
}
