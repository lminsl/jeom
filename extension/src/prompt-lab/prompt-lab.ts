import {
  DEFAULT_NOTE_PROMPT,
  type DebugInfo,
  type NoteGenTelemetry,
  type SentenceInput,
} from "../lib/api";
import { listDebugSessions, type DebugSession } from "../lib/debug-session";
import {
  listGoldNotesForSession,
  saveGoldNote,
  type GoldNote,
} from "../lib/gold-note";
import type {
  PromptImprovementExample,
  PromptImprovementResult,
} from "../lib/prompt-improver";
import { getConfig } from "../lib/storage";

interface AnnotateResponse {
  ok: boolean;
  notes?: Record<string, string>;
  debug?: Record<string, DebugInfo>;
  telemetry?: NoteGenTelemetry;
  error?: string;
}

type ImprovePromptResponse =
  | ({ ok: true } & PromptImprovementResult)
  | { ok: false; error: string };

type PromptDiffLine =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

const sessionPicker = document.getElementById("session-picker") as HTMLSelectElement;
const loadUrlForm = document.getElementById("load-url-form") as HTMLFormElement;
const urlInput = document.getElementById("url-input") as HTMLInputElement;
const loadUrlBtn = document.getElementById("load-url") as HTMLButtonElement;
const sessionMeta = document.getElementById("session-meta") as HTMLParagraphElement;
const sentenceCount = document.getElementById("sentence-count") as HTMLSpanElement;
const sentencesEl = document.getElementById("sentences") as HTMLDivElement;
const promptEditor = document.getElementById("prompt-editor") as HTMLTextAreaElement;
const resetPromptBtn = document.getElementById("reset-prompt") as HTMLButtonElement;
const generateBtn = document.getElementById("generate") as HTMLButtonElement;
const improvePromptBtn = document.getElementById(
  "improve-prompt",
) as HTMLButtonElement;
const goldCountEl = document.getElementById("gold-count") as HTMLSpanElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const outputEl = document.getElementById("output") as HTMLDivElement;
const runMeta = document.getElementById("run-meta") as HTMLSpanElement;
const improvementResultEl = document.getElementById(
  "improvement-result",
) as HTMLDivElement;

let sessions: DebugSession[] = [];
let currentSession: DebugSession | null = null;
let currentNotes: Record<string, string> = {};
let goldNotesByKey = new Map<string, GoldNote>();
let pendingDraftPrompt: string | null = null;
type SyncPane = "sentences" | "output";
let scrollSyncSource: SyncPane | null = null;
let scrollSyncResetTimer: number | null = null;
let sentenceScrollFrame: number | null = null;
let outputScrollFrame: number | null = null;

sessionPicker.addEventListener("change", () => {
  const selected = sessions.find((session) => session.id === sessionPicker.value) ?? null;
  selectSession(selected);
});

resetPromptBtn.addEventListener("click", () => {
  promptEditor.value = currentSession?.baselinePrompt || DEFAULT_NOTE_PROMPT;
});

generateBtn.addEventListener("click", () => {
  void generate();
});

improvePromptBtn.addEventListener("click", () => {
  void improvePromptFromGold();
});

improvementResultEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("[data-improvement-action]");
  if (!button) return;
  if (button.dataset.improvementAction === "apply") {
    applyPendingDraftPrompt();
  }
  if (button.dataset.improvementAction === "copy") {
    void copyPendingDraftPrompt();
  }
});

outputEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>(".save-gold");
  if (!button) return;
  void saveGoldFromRow(button.dataset.sentenceKey ?? "");
});

loadUrlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadUrl();
});

installScrollSync();
void init();

async function init(): Promise<void> {
  sessions = await listDebugSessions();
  renderSessionPicker();
  selectSession(sessions[0] ?? null);
}

function renderSessionPicker(): void {
  sessionPicker.replaceChildren();
  if (sessions.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No captured sessions";
    option.value = "";
    sessionPicker.appendChild(option);
    sessionPicker.disabled = true;
    generateBtn.disabled = true;
    resetPromptBtn.disabled = true;
    improvePromptBtn.disabled = true;
    return;
  }

  sessionPicker.disabled = false;
  generateBtn.disabled = false;
  resetPromptBtn.disabled = false;
  improvePromptBtn.disabled = false;
  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = `${formatDate(session.createdAt)} · ${session.title || session.url}`;
    sessionPicker.appendChild(option);
  }
}

async function reloadSessions(selectId?: string): Promise<void> {
  sessions = await listDebugSessions();
  renderSessionPicker();
  const selected =
    sessions.find((session) => session.id === selectId) ??
    sessions[0] ??
    null;
  selectSession(selected);
}

function selectSession(session: DebugSession | null): void {
  currentSession = session;
  currentNotes = {};
  goldNotesByKey = new Map();
  statusEl.textContent = "";
  runMeta.textContent = "";
  goldCountEl.textContent = "";
  pendingDraftPrompt = null;
  improvementResultEl.hidden = true;
  improvementResultEl.replaceChildren();
  outputEl.replaceChildren();

  if (!session) {
    sessionMeta.textContent = "Annotate an article in developer mode, then reopen Prompt Lab.";
    sentenceCount.textContent = "";
    sentencesEl.replaceChildren(emptyState("No captured sentences."));
    promptEditor.value = DEFAULT_NOTE_PROMPT;
    improvePromptBtn.disabled = true;
    return;
  }

  sessionPicker.value = session.id;
  sessionMeta.textContent = `${session.title || "(untitled)"} · ${session.url} · ${session.provider}/${session.model}`;
  sentenceCount.textContent = `${session.sentences.length} sentences`;
  promptEditor.value = session.baselinePrompt || DEFAULT_NOTE_PROMPT;
  renderSentences(session.sentences);
  renderOutput({
    baselineNotes: session.baselineNotes,
    currentNotes,
    sentences: session.sentences,
  });
  sentencesEl.scrollTop = 0;
  outputEl.scrollTop = 0;
  void loadGoldNotes(session.id);
}

function renderSentences(sentences: SentenceInput[]): void {
  const nodes = sentences.map((sentence, index) => {
    const row = document.createElement("div");
    row.className = "sentence";
    row.dataset.sentenceIndex = String(index);
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = `[${index}]`;
    const text = document.createElement("span");
    text.className = "sentence-text";
    text.textContent = sentence.text;
    row.append(idx, text);
    return row;
  });
  sentencesEl.replaceChildren(...nodes);
}

async function generate(): Promise<void> {
  if (!currentSession) return;

  generateBtn.disabled = true;
  statusEl.textContent = "Generating...";
  runMeta.textContent = "";

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "ANNOTATE_REQUEST",
      title: currentSession.title,
      sentences: currentSession.sentences,
      promptOverride: promptEditor.value,
    })) as AnnotateResponse | undefined;

    if (!response?.ok) {
      throw new Error(response?.error ?? "Prompt Lab generation failed.");
    }

    currentNotes = response.notes ?? {};
    renderOutput({
      baselineNotes: currentSession.baselineNotes,
      currentNotes,
      sentences: currentSession.sentences,
    });
    const telemetry = response.telemetry;
    runMeta.textContent = telemetry
      ? `${telemetry.noteCount}/${telemetry.sentenceCount} notes · ${telemetry.latencyMs}ms`
      : `${Object.keys(currentNotes).length} notes`;
    statusEl.textContent = "Done";
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    generateBtn.disabled = false;
  }
}

async function loadGoldNotes(sessionId: string): Promise<void> {
  const notes = await listGoldNotesForSession(sessionId);
  goldNotesByKey = new Map(notes.map((note) => [note.sentenceKey, note]));
  updateGoldCount();
  if (currentSession?.id === sessionId) {
    renderOutput({
      baselineNotes: currentSession.baselineNotes,
      currentNotes,
      sentences: currentSession.sentences,
    });
  }
}

async function saveGoldFromRow(sentenceKey: string): Promise<void> {
  if (!currentSession || !sentenceKey) return;
  const textarea = outputEl.querySelector<HTMLTextAreaElement>(
    `.gold-editor[data-sentence-key="${cssEscape(sentenceKey)}"]`,
  );
  const status = outputEl.querySelector<HTMLElement>(
    `.gold-status[data-sentence-key="${cssEscape(sentenceKey)}"]`,
  );
  const goldNote = textarea?.value.trim() ?? "";
  if (!textarea || !goldNote) {
    if (status) status.textContent = "Add a gold note first.";
    return;
  }

  const sentence = currentSession.sentences.find(
    (item) => sentenceKeyFor(item) === sentenceKey,
  );
  if (!sentence) return;

  const saved = await saveGoldNote({
    session: currentSession,
    sentence,
    sentenceKey,
    sentenceText: sentence.text,
    baselineNote: currentSession.baselineNotes[sentenceKey] ?? null,
    currentNote: currentNotes[sentenceKey] ?? null,
    goldNote,
  });
  goldNotesByKey.set(sentenceKey, saved);
  updateGoldCount();
  if (status) status.textContent = "Saved";
}

async function improvePromptFromGold(): Promise<void> {
  if (!currentSession) return;
  const notes = Array.from(goldNotesByKey.values());
  if (notes.length === 0) {
    statusEl.textContent = "Save at least one gold note first.";
    return;
  }

  improvePromptBtn.disabled = true;
  statusEl.textContent = "Improving prompt...";
  improvementResultEl.hidden = true;
  const examples: PromptImprovementExample[] = notes.map((note) => ({
    sentenceText: note.sentenceText,
    baselineNote: note.baselineNote,
    currentNote: note.currentNote,
    goldNote: note.goldNote,
    comment: note.comment,
  }));

  try {
    const sourcePrompt = promptEditor.value;
    const response = (await chrome.runtime.sendMessage({
      type: "IMPROVE_PROMPT_REQUEST",
      currentPrompt: sourcePrompt,
      examples,
    })) as ImprovePromptResponse | undefined;
    if (!response?.ok) {
      throw new Error(response?.error ?? "Prompt improvement failed.");
    }
    pendingDraftPrompt = response.draftPrompt;
    renderImprovementResult({
      result: response,
      sourcePrompt,
    });
    statusEl.textContent = "Prompt draft ready";
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    improvePromptBtn.disabled = false;
  }
}

async function loadUrl(): Promise<void> {
  const url = normalizeArticleUrl(urlInput.value);
  if (!url) {
    statusEl.textContent = "Enter a normal http/https URL.";
    return;
  }

  loadUrlBtn.disabled = true;
  statusEl.textContent = "Loading URL...";
  const beforeIds = new Set(sessions.map((session) => session.id));

  try {
    const cfg = await getConfig();
    if (!cfg.developerMode) {
      throw new Error("Enable Developer Mode before loading URLs into Prompt Lab.");
    }
    if (!cfg.llm.apiKey) {
      throw new Error("Set an LLM API key before loading URLs into Prompt Lab.");
    }

    const tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error("Chrome did not return a tab id.");
    await waitForTabLoad(tab.id);
    const response = await sendActivateWithRetry(tab.id);
    if (!response?.ok) {
      throw new Error(response?.error ?? "Annotation failed while loading URL.");
    }

    const captured = await waitForCapturedSession(beforeIds, url);
    await reloadSessions(captured.id);
    statusEl.textContent = "Loaded";
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    loadUrlBtn.disabled = false;
  }
}

function normalizeArticleUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function waitForTabLoad(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for the article tab to load."));
    }, 30_000);
    const listener = (
      updatedTabId: number,
      changeInfo: { status?: string },
    ): void => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendActivateWithRetry(
  tabId: number,
): Promise<{ ok: boolean; error?: string } | undefined> {
  let injected = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: "ACTIVATE" })) as
        | { ok: boolean; error?: string }
        | undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Could not establish connection")) throw err;
      if (!injected) {
        injected = true;
        await chrome.scripting.executeScript({
          target: { tabId },
          files: contentScriptFiles(),
        });
      }
      statusEl.textContent = `Waiting for content script (${attempt}/6)...`;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Content script did not become ready for this URL.");
}

function contentScriptFiles(): string[] {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files?.length) {
    throw new Error("Jeom content script is missing from the manifest.");
  }
  return files;
}

async function waitForCapturedSession(
  beforeIds: Set<string>,
  url: string,
): Promise<DebugSession> {
  const normalized = normalizeComparableUrl(url);
  for (let attempt = 0; attempt < 40; attempt++) {
    const nextSessions = await listDebugSessions();
    const newSessions = nextSessions.filter(
      (session) => !beforeIds.has(session.id),
    );
    const captured = newSessions.find(
      (session) =>
        normalizeComparableUrl(session.url) === normalized,
    );
    if (captured) return captured;
    if (newSessions[0]) return newSessions[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Annotation finished, but no Prompt Lab session was captured.");
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function renderOutput(args: {
  baselineNotes: Record<string, string>;
  currentNotes: Record<string, string>;
  sentences: SentenceInput[];
}): void {
  const rows = args.sentences.map((sentence, index) => {
    const key = `${sentence.paragraphIndex}::${sentence.sentenceIndex}`;
    const row = document.createElement("div");
    row.className = "note-row";
    row.dataset.sentenceIndex = String(index);

    const idx = document.createElement("div");
    idx.className = "idx";
    idx.textContent = `[${index}]`;

    const baselineLabel = label("Baseline");
    const baseline = note(args.baselineNotes[key]);
    const currentLabel = label("Current");
    const current = note(args.currentNotes[key]);
    const goldLabel = label("Ground truth");
    const goldEditor = document.createElement("textarea");
    goldEditor.className = "gold-editor";
    goldEditor.dataset.sentenceKey = key;
    goldEditor.placeholder = "Write the note Jeom should have produced.";
    goldEditor.value = goldNotesByKey.get(key)?.goldNote ?? "";
    const goldActions = document.createElement("div");
    goldActions.className = "gold-actions";
    const saveButton = document.createElement("button");
    saveButton.className = "save-gold";
    saveButton.type = "button";
    saveButton.dataset.sentenceKey = key;
    saveButton.textContent = goldNotesByKey.has(key) ? "Update gold" : "Save gold";
    const goldStatus = document.createElement("span");
    goldStatus.className = "gold-status";
    goldStatus.dataset.sentenceKey = key;
    goldStatus.textContent = goldNotesByKey.has(key) ? "Saved" : "";
    goldActions.append(saveButton, goldStatus);

    row.append(
      idx,
      baselineLabel,
      baseline,
      currentLabel,
      current,
      goldLabel,
      goldEditor,
      goldActions,
    );
    return row;
  });
  outputEl.replaceChildren(...rows);
}

function renderImprovementResult(args: {
  result: PromptImprovementResult;
  sourcePrompt: string;
}): void {
  improvementResultEl.replaceChildren(
    resultSection("Diagnosis", args.result.diagnosis),
    resultSection("Patch", args.result.patch),
    renderDiffSection(args.sourcePrompt, args.result.draftPrompt),
    renderImprovementActions(),
  );
  improvementResultEl.hidden = false;
}

function resultSection(title: string, body: string): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = body;
  section.append(heading, pre);
  return section;
}

function renderDiffSection(sourcePrompt: string, draftPrompt: string): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = "Prompt Diff";
  const diff = document.createElement("div");
  diff.className = "prompt-diff";
  for (const line of diffPromptLines(sourcePrompt, draftPrompt)) {
    const row = document.createElement("div");
    row.className = `diff-line diff-${line.kind}`;
    const marker = document.createElement("span");
    marker.className = "diff-marker";
    marker.textContent =
      line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
    const text = document.createElement("span");
    text.className = "diff-text";
    text.textContent = line.text || " ";
    row.append(marker, text);
    diff.appendChild(row);
  }
  section.append(heading, diff);
  return section;
}

function renderImprovementActions(): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "improvement-actions";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.dataset.improvementAction = "apply";
  apply.textContent = "Apply Draft";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary-action";
  copy.dataset.improvementAction = "copy";
  copy.textContent = "Copy Draft";
  actions.append(apply, copy);
  return actions;
}

function applyPendingDraftPrompt(): void {
  if (!pendingDraftPrompt) return;
  promptEditor.value = pendingDraftPrompt;
  statusEl.textContent = "Draft applied";
}

async function copyPendingDraftPrompt(): Promise<void> {
  if (!pendingDraftPrompt) return;
  await navigator.clipboard.writeText(pendingDraftPrompt);
  statusEl.textContent = "Draft copied";
}

function diffPromptLines(
  sourcePrompt: string,
  draftPrompt: string,
): PromptDiffLine[] {
  const source = sourcePrompt.split("\n");
  const draft = draftPrompt.split("\n");
  const lcs = Array.from({ length: source.length + 1 }, () =>
    Array<number>(draft.length + 1).fill(0),
  );

  for (let i = source.length - 1; i >= 0; i--) {
    for (let j = draft.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        source[i] === draft[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const lines: PromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < source.length && j < draft.length) {
    const sourceLine = source[i] ?? "";
    const draftLine = draft[j] ?? "";
    if (sourceLine === draftLine) {
      lines.push({ kind: "same", text: sourceLine });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      lines.push({ kind: "removed", text: sourceLine });
      i++;
    } else {
      lines.push({ kind: "added", text: draftLine });
      j++;
    }
  }
  while (i < source.length) {
    lines.push({ kind: "removed", text: source[i] ?? "" });
    i++;
  }
  while (j < draft.length) {
    lines.push({ kind: "added", text: draft[j] ?? "" });
    j++;
  }
  return lines;
}

function installScrollSync(): void {
  sentencesEl.addEventListener("scroll", () => {
    scheduleScrollSync("sentences");
  });
  outputEl.addEventListener("scroll", () => {
    scheduleScrollSync("output");
  });
}

function scheduleScrollSync(source: SyncPane): void {
  if (scrollSyncSource !== null && scrollSyncSource !== source) return;
  scrollSyncSource = source;

  const existingFrame =
    source === "sentences" ? sentenceScrollFrame : outputScrollFrame;
  if (existingFrame !== null) return;

  const frame = requestAnimationFrame(() => {
    if (source === "sentences") {
      sentenceScrollFrame = null;
    } else {
      outputScrollFrame = null;
    }

    const sourceEl = source === "sentences" ? sentencesEl : outputEl;
    const targetEl = source === "sentences" ? outputEl : sentencesEl;
    const index = topVisibleSentenceIndex(sourceEl);
    if (index !== null) scrollToSentenceIndex(targetEl, index);

    if (scrollSyncResetTimer !== null) {
      window.clearTimeout(scrollSyncResetTimer);
    }
    scrollSyncResetTimer = window.setTimeout(() => {
      scrollSyncSource = null;
      scrollSyncResetTimer = null;
    }, 120);
  });

  if (source === "sentences") {
    sentenceScrollFrame = frame;
  } else {
    outputScrollFrame = frame;
  }
}

function topVisibleSentenceIndex(container: HTMLElement): number | null {
  const containerTop = container.getBoundingClientRect().top;
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>("[data-sentence-index]"),
  );
  for (const row of rows) {
    if (row.getBoundingClientRect().bottom >= containerTop + 4) {
      const raw = row.dataset.sentenceIndex;
      return raw === undefined ? null : Number(raw);
    }
  }
  return null;
}

function scrollToSentenceIndex(container: HTMLElement, index: number): void {
  const row = container.querySelector<HTMLElement>(
    `[data-sentence-index="${index}"]`,
  );
  if (!row) return;
  container.scrollTop = row.offsetTop - container.offsetTop;
}

function label(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "note-label";
  el.textContent = text;
  return el;
}

function note(text: string | undefined): HTMLDivElement {
  const el = document.createElement("div");
  el.className = text ? "note-text" : "note-text empty";
  el.textContent = text || "No note";
  return el;
}

function updateGoldCount(): void {
  const count = goldNotesByKey.size;
  goldCountEl.textContent = `${count} gold saved`;
}

function sentenceKeyFor(sentence: SentenceInput): string {
  return `${sentence.paragraphIndex}::${sentence.sentenceIndex}`;
}

function cssEscape(value: string): string {
  return CSS.escape(value);
}

function emptyState(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "empty";
  el.textContent = text;
  return el;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
