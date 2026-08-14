import type { DebugSession } from "./debug-session";
import type { SentenceInput } from "./api";

const GOLD_NOTES_KEY = "promptLabGoldNotes";
const MAX_GOLD_NOTES = 500;

export interface GoldNote {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sentenceKey: string;
  sentenceText: string;
  baselinePrompt: string;
  baselineNote: string | null;
  baselineRawResponse: string | null;
  currentNote: string | null;
  goldNote: string;
  comment: string | null;
}

interface GoldNoteStore {
  promptLabGoldNotes?: unknown;
}

export async function saveGoldNote(input: {
  session: DebugSession;
  sentence: SentenceInput;
  sentenceKey: string;
  sentenceText: string;
  baselineNote: string | null;
  currentNote: string | null;
  goldNote: string;
  comment?: string | null;
}): Promise<GoldNote> {
  const existing = await listGoldNotes();
  const now = new Date().toISOString();
  const prior = existing.find(
    (note) =>
      note.sessionId === input.session.id &&
      note.sentenceKey === input.sentenceKey,
  );
  const next: GoldNote = {
    id: prior?.id ?? crypto.randomUUID(),
    sessionId: input.session.id,
    url: input.session.url,
    title: input.session.title,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
    sentenceKey: input.sentenceKey,
    sentenceText: input.sentenceText,
    baselinePrompt: input.session.baselinePrompt,
    baselineNote: input.baselineNote,
    baselineRawResponse: input.session.baselineRawResponse || null,
    currentNote: input.currentNote,
    goldNote: input.goldNote,
    comment: input.comment ?? null,
  };
  const withoutPrior = existing.filter((note) => note.id !== next.id);
  await chrome.storage.local.set({
    [GOLD_NOTES_KEY]: [next, ...withoutPrior].slice(0, MAX_GOLD_NOTES),
  });
  return next;
}

export async function listGoldNotes(): Promise<GoldNote[]> {
  const stored = (await chrome.storage.local.get([
    GOLD_NOTES_KEY,
  ])) as GoldNoteStore;
  const value = stored.promptLabGoldNotes;
  if (!Array.isArray(value)) return [];
  return value.filter(isGoldNote);
}

export async function listGoldNotesForSession(
  sessionId: string,
): Promise<GoldNote[]> {
  const notes = await listGoldNotes();
  return notes.filter((note) => note.sessionId === sessionId);
}

function isGoldNote(value: unknown): value is GoldNote {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GoldNote>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.sentenceKey === "string" &&
    typeof candidate.sentenceText === "string" &&
    typeof candidate.baselinePrompt === "string" &&
    typeof candidate.goldNote === "string"
  );
}
