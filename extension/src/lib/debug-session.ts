import type { AnnotationResult, SentenceInput } from "./api";
import type { LLMConfig } from "./selector-llm";

const DEBUG_SESSIONS_KEY = "promptLabDebugSessions";
const MAX_DEBUG_SESSIONS = 12;

export interface DebugSession {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  provider: LLMConfig["provider"];
  model: string;
  sentences: SentenceInput[];
  baselinePrompt: string;
  baselineRawResponse: string;
  baselineNotes: Record<string, string>;
}

interface DebugSessionStore {
  promptLabDebugSessions?: unknown;
}

export async function saveDebugSession(input: {
  url: string;
  title: string;
  llm: LLMConfig;
  sentences: SentenceInput[];
  annotation: Pick<AnnotationResult, "notes" | "telemetry">;
}): Promise<DebugSession> {
  const existing = await listDebugSessions();
  const session: DebugSession = {
    id: crypto.randomUUID(),
    url: input.url,
    title: input.title,
    createdAt: new Date().toISOString(),
    provider: input.llm.provider,
    model: input.llm.model,
    sentences: input.sentences,
    baselinePrompt: input.annotation.telemetry.promptTemplate,
    baselineRawResponse: input.annotation.telemetry.rawResponse,
    baselineNotes: input.annotation.notes,
  };

  await chrome.storage.local.set({
    [DEBUG_SESSIONS_KEY]: [session, ...existing].slice(0, MAX_DEBUG_SESSIONS),
  });
  return session;
}

export async function listDebugSessions(): Promise<DebugSession[]> {
  const stored = (await chrome.storage.local.get([
    DEBUG_SESSIONS_KEY,
  ])) as DebugSessionStore;
  const value = stored.promptLabDebugSessions;
  if (!Array.isArray(value)) return [];
  return value.filter(isDebugSession);
}

function isDebugSession(value: unknown): value is DebugSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DebugSession>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string" &&
    Array.isArray(candidate.sentences) &&
    typeof candidate.baselinePrompt === "string" &&
    typeof candidate.baselineRawResponse === "string" &&
    typeof candidate.baselineNotes === "object" &&
    candidate.baselineNotes !== null
  );
}
