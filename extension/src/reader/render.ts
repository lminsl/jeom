/** The reader overlay UI.
 *
 * Injects a fullscreen iframe-like overlay (actually a positioned div with
 * shadow DOM to insulate styling) that shows the article paragraph by
 * paragraph. Each sentence ends with its real period; if there is a note,
 * the period becomes a clickable target — click reveals the note.
 *
 * v0 interaction (per user direction):
 *   - Click on the period → reveal the note inline.
 *   - For Socratic notes (note text ends with "?"), the note IS the
 *     question. A second click reveals the expansion if the note contains
 *     " — " (em-dash separator).
 *   - Click the period again to collapse.
 */

import readerCss from "./reader.css?inline";

export interface RenderArgs {
  title: string;
  paragraphs: { index: number; sentences: { index: number; text: string }[] }[];
  notes: Record<string, string>;
  debug: Record<string, { why: string | null; interaction: string | null }>;
  usage?: { inputTokens: number; outputTokens: number };
  /** If set, only the first N sentences were sent for annotation. */
  truncatedAt?: number;
  totalSentences?: number;
  loading?: boolean;
  error?: string;
  replaceId?: string;
}

const HOST_ID_PREFIX = "jeom-host-";

export function renderReader(args: RenderArgs): string {
  // Reuse the host element if replacing.
  const id = args.replaceId ?? HOST_ID_PREFIX + Math.random().toString(36).slice(2, 10);
  let host = document.getElementById(id) as HTMLElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = id;
    host.style.all = "initial";
    document.documentElement.appendChild(host);
  }
  // Use shadow DOM to isolate from page CSS.
  let shadow = host.shadowRoot;
  if (!shadow) {
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = readerCss;
    shadow.appendChild(style);
  }
  // Wipe and re-render.
  for (const node of Array.from(shadow.querySelectorAll(".ra-root"))) {
    node.remove();
  }

  const root = document.createElement("div");
  root.className = "ra-root";
  shadow.appendChild(root);

  const overlay = document.createElement("div");
  overlay.className = "ra-overlay";
  root.appendChild(overlay);

  const panel = document.createElement("div");
  panel.className = "ra-panel";
  overlay.appendChild(panel);

  // Header
  const header = document.createElement("div");
  header.className = "ra-header";
  const titleEl = document.createElement("div");
  titleEl.className = "ra-title";
  titleEl.textContent = args.title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement("button");
  closeBtn.className = "ra-close";
  closeBtn.textContent = "×";
  closeBtn.title = "Close";
  closeBtn.onclick = () => host?.remove();
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Loading state
  if (args.loading) {
    const loader = document.createElement("div");
    loader.className = "ra-loader";
    loader.textContent = "Annotating with GPT-5… (typically 30–120s)";
    panel.appendChild(loader);
  }

  // Error state
  if (args.error) {
    const errEl = document.createElement("div");
    errEl.className = "ra-error";
    errEl.textContent = `Error: ${args.error}`;
    panel.appendChild(errEl);
  }

  // Truncation banner
  if (args.truncatedAt && args.totalSentences && args.truncatedAt < args.totalSentences) {
    const banner = document.createElement("div");
    banner.className = "ra-warn";
    banner.textContent =
      `Article is long (${args.totalSentences} sentences). To keep the call fast and inexpensive, only the first ${args.truncatedAt} sentences were sent for annotation. The full article is shown below — sentences past the cap are not annotated.`;
    panel.appendChild(banner);
  }

  // Stats
  if (args.usage) {
    const stats = document.createElement("div");
    stats.className = "ra-stats";
    const noteCount = Object.keys(args.notes).length;
    const annotatedRange =
      args.truncatedAt && args.totalSentences && args.truncatedAt < args.totalSentences
        ? `${noteCount}/${args.truncatedAt} annotated (of ${args.totalSentences} total)`
        : `${noteCount}/${
            args.totalSentences ?? args.paragraphs.reduce((a, p) => a + p.sentences.length, 0)
          } sentences annotated`;
    const cost =
      (args.usage.inputTokens * 5.0) / 1_000_000 +
      (args.usage.outputTokens * 20.0) / 1_000_000;
    stats.textContent = `${annotatedRange} · ~$${cost.toFixed(3)}`;
    panel.appendChild(stats);
  }

  // Article body
  const body = document.createElement("div");
  body.className = "ra-body";
  panel.appendChild(body);

  for (const p of args.paragraphs) {
    const para = document.createElement("p");
    para.className = "ra-para";
    for (let i = 0; i < p.sentences.length; i++) {
      const s = p.sentences[i]!;
      const k = `${p.index}::${s.index}`;
      const note = args.notes[k];
      const span = document.createElement("span");
      span.className = "ra-sentence";
      if (note) span.classList.add("ra-has-note");
      span.append(renderSentenceWithPeriodTrigger(s.text, note));
      para.appendChild(span);
      if (i < p.sentences.length - 1) para.appendChild(document.createTextNode(" "));
    }
    body.appendChild(para);
  }

  // ESC to close
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      host?.remove();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  return id;
}

function renderSentenceWithPeriodTrigger(
  text: string,
  note: string | undefined,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!note) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  // Find the trailing period (or !, ?). If absent, append a marker dot.
  const m = text.match(/^([\s\S]*?)([.!?])(["'”’)]*)\s*$/);
  if (m) {
    frag.appendChild(document.createTextNode(m[1] ?? ""));
    const periodEl = document.createElement("span");
    periodEl.className = "ra-period";
    periodEl.textContent = (m[2] ?? "") + (m[3] ?? "");
    periodEl.title = "Click to reveal note";
    const noteEl = createNoteElement(note);
    let revealed = false;
    let expanded = false;
    periodEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!revealed) {
        revealed = true;
        periodEl.classList.add("ra-period-active");
        noteEl.classList.add("ra-note-shown");
      } else if (!expanded && noteEl.dataset.hasExpansion === "1") {
        expanded = true;
        const expSpan = noteEl.querySelector(".ra-note-expansion") as HTMLElement | null;
        if (expSpan) expSpan.classList.add("ra-note-expansion-shown");
      } else {
        revealed = false;
        expanded = false;
        periodEl.classList.remove("ra-period-active");
        noteEl.classList.remove("ra-note-shown");
        const expSpan = noteEl.querySelector(".ra-note-expansion") as HTMLElement | null;
        if (expSpan) expSpan.classList.remove("ra-note-expansion-shown");
      }
    });
    frag.appendChild(periodEl);
    frag.appendChild(noteEl);
  } else {
    // No clean ending punctuation — append a marker dot.
    frag.appendChild(document.createTextNode(text));
    const periodEl = document.createElement("span");
    periodEl.className = "ra-period ra-period-synth";
    periodEl.textContent = "·";
    periodEl.title = "Click to reveal note";
    frag.appendChild(periodEl);
    frag.appendChild(createNoteElement(note));
  }
  return frag;
}

function createNoteElement(note: string): HTMLElement {
  const noteEl = document.createElement("span");
  noteEl.className = "ra-note";

  // Two-step reveal triggers when the note contains a question followed by
  // an expansion. v7 prompt produces two real shapes:
  //   (a) "phrase — is X really true? Counterexample: ..."
  //   (b) "Question with no anchor? Expansion text..."
  // In both, the FIRST `?` is the boundary: question on click 1, expansion
  // on click 2. We require non-trivial content after the `?` to count as
  // an expansion (≥ 2 words, ≥ 8 chars).
  const qMatch = note.match(/^(.+?\?)\s+(.+)$/s);
  const expansionLooksReal =
    qMatch &&
    qMatch[2]!.trim().length >= 8 &&
    qMatch[2]!.trim().split(/\s+/).length >= 2;
  if (qMatch && expansionLooksReal) {
    const q = qMatch[1]!;
    const exp = qMatch[2]!;
    const qSpan = document.createElement("span");
    qSpan.className = "ra-note-question";
    qSpan.textContent = q;
    const expSpan = document.createElement("span");
    expSpan.className = "ra-note-expansion";
    expSpan.textContent = " " + exp;
    noteEl.append(qSpan, expSpan);
    noteEl.dataset.hasExpansion = "1";
  } else {
    noteEl.textContent = note;
  }
  return noteEl;
}
