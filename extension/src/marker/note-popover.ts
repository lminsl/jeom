/** Singleton sticky-note popover. Hover-based: 120ms close-grace lets the
 *  cursor travel dot → note without flicker. ESC always closes. Position is
 *  margin-sticky (to the right of the article-root); falls back to
 *  overlay-below-dot when the right margin doesn't fit the viewport.
 */

export interface ShowPopoverOpts {
  dot: HTMLElement;
  body: string; // HTML — v7 prompt produces <em>/<strong> markup
  root: Element; // article root, used for margin-sticky positioning
}

const CLOSE_DELAY_MS = 120;
const NOTE_WIDTH_PX = 280;
const NOTE_MARGIN_PX = 16;
const NOTE_RIGHT_GUTTER_PX = 24;
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
]);

let openDot: HTMLElement | null = null;
let openNote: HTMLElement | null = null;
let closeTimer: number | null = null;
let escListener: ((e: KeyboardEvent) => void) | null = null;
let scrollListener: (() => void) | null = null;
let resizeListener: (() => void) | null = null;
let currentRoot: Element | null = null;

export function showPopover(opts: ShowPopoverOpts): void {
  cancelClose();
  if (openDot === opts.dot) return;
  closeOpen();

  const note = document.createElement("div");
  note.className = "ra-note";
  applyArticleTypography(note, opts.dot);

  // Body is HTML from the LLM (v7 prompt produces em/strong markup). Trusted
  // source (our own API call result); rendered as HTML to preserve emphasis.
  const bodyDiv = document.createElement("div");
  bodyDiv.innerHTML = opts.body;
  note.appendChild(bodyDiv);

  document.body.appendChild(note);
  currentRoot = opts.root;
  positionNote(note, opts.dot, opts.root);

  note.addEventListener("mouseenter", cancelClose);
  note.addEventListener("mouseleave", scheduleClose);

  opts.dot.classList.add("active");
  openDot = opts.dot;
  openNote = note;

  registerGlobalListeners();
}

export function scheduleClose(): void {
  if (closeTimer !== null) window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    closeOpen();
    closeTimer = null;
  }, CLOSE_DELAY_MS);
}

function cancelClose(): void {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function closeOpen(): void {
  if (openNote) {
    openNote.remove();
    openNote = null;
  }
  if (openDot) {
    openDot.classList.remove("active");
    openDot = null;
  }
  currentRoot = null;
}

function positionNote(note: HTMLElement, dot: HTMLElement, root: Element): void {
  const rect = dot.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();

  let left = rootRect.right + NOTE_RIGHT_GUTTER_PX;
  let top = rect.top - 6;

  // Margin-sticky doesn't fit at this viewport width → fall back to
  // overlay-below-dot. Keeps the note on-screen on narrow viewports.
  if (left + NOTE_WIDTH_PX + NOTE_MARGIN_PX > window.innerWidth) {
    left = Math.max(
      NOTE_MARGIN_PX,
      Math.min(rect.left, window.innerWidth - NOTE_WIDTH_PX - NOTE_MARGIN_PX),
    );
    top = rect.bottom + 8;
  }
  if (top < NOTE_MARGIN_PX) top = NOTE_MARGIN_PX;
  if (top + 200 > window.innerHeight) top = window.innerHeight - 220;

  note.style.left = `${left}px`;
  note.style.top = `${top}px`;
}

function registerGlobalListeners(): void {
  if (escListener === null) {
    escListener = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeOpen();
    };
    document.addEventListener("keydown", escListener);
  }
  if (scrollListener === null) {
    scrollListener = (): void => {
      if (openDot && openNote && currentRoot) {
        positionNote(openNote, openDot, currentRoot);
      }
    };
    window.addEventListener("scroll", scrollListener, { passive: true });
  }
  if (resizeListener === null) {
    resizeListener = (): void => {
      if (openDot && openNote && currentRoot) {
        positionNote(openNote, openDot, currentRoot);
      }
    };
    window.addEventListener("resize", resizeListener);
  }
}

export function disposeAllPopovers(): void {
  closeOpen();
  cancelClose();
  if (escListener !== null) {
    document.removeEventListener("keydown", escListener);
    escListener = null;
  }
  if (scrollListener !== null) {
    window.removeEventListener("scroll", scrollListener);
    scrollListener = null;
  }
  if (resizeListener !== null) {
    window.removeEventListener("resize", resizeListener);
    resizeListener = null;
  }
}

/** @internal — exported for testing */
export function _getOpenDotForTesting(): HTMLElement | null {
  return openDot;
}

function applyArticleTypography(note: HTMLElement, dot: HTMLElement): void {
  const fontFamily = noteFontFamilyFromArticle(getComputedStyle(dot).fontFamily);
  if (fontFamily === null) return;
  note.style.setProperty("--ra-note-font-family", fontFamily);
}

/** @internal — exported for testing */
export function noteFontFamilyFromArticle(fontFamily: string): string | null {
  const families = fontFamily
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (families.length === 0) return null;

  const genericSuffix: string[] = [];
  while (families.length > 0) {
    const last = families[families.length - 1]!;
    if (!GENERIC_FONT_FAMILIES.has(last.toLowerCase())) break;
    genericSuffix.unshift(families.pop()!);
  }
  if (families.length === 0) return null;

  return [
    ...families,
    '"Apple SD Gothic Neo"',
    '"Noto Sans KR"',
    ...genericSuffix,
  ].join(", ");
}
