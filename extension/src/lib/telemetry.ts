import type { InjectMarkersHandle } from "../marker/inject";
import type { LLMConfig, SelectorTelemetry } from "./selector-llm";
import type { NoteGenTelemetry } from "./api";
import { DOGFOOD_SUPABASE_ANON_KEY, DOGFOOD_SUPABASE_URL } from "./dogfood-config";

const FIELD_LIMIT = 50_000;
const SK_RE = /sk-[A-Za-z0-9_-]*/g;

export interface RenderTelemetry {
  dotsInjected: number;
  skippedNoPeriod: number;
  skippedNoNote: number;
}

export interface SessionTelemetryInput {
  url: string;
  title: string;
  extVersion: string;
  userAgent: string;
  llm: LLMConfig;
  selectorStep?: SelectorTelemetry;
  noteGenStep?: NoteGenTelemetry;
  renderStep: InjectMarkersHandle | RenderTelemetry;
}

export interface SessionTelemetryPayload {
  url: string;
  title: string;
  ext_version: string;
  user_agent: string;
  provider: LLMConfig["provider"];
  model: string;
  selector_step: {
    prompt: string;
    rawResponse: string;
    parsedSelector: string;
    kind: string;
    source: string;
    latencyMs: number;
    errorClass: string | null;
  };
  note_gen_step: {
    sentenceCount: number;
    prompt: string;
    rawResponse: string;
    noteCount: number;
    latencyMs: number;
    errorClass: string | null;
  };
  render_step: RenderTelemetry;
}

export interface ClientEventInput {
  eventType: "outdated_version";
  extVersion: string;
  url: string;
  details: Record<string, string | number | boolean | null>;
}

interface LogSessionOpts {
  fetchFn?: typeof fetch;
  supabaseUrl?: string;
  anonKey?: string;
  enabled?: boolean;
}

export function buildSessionEvent(
  input: SessionTelemetryInput,
): SessionTelemetryPayload {
  return {
    url: clean(input.url),
    title: clean(input.title),
    ext_version: clean(input.extVersion),
    user_agent: clean(input.userAgent),
    provider: input.llm.provider,
    model: clean(input.llm.model),
    selector_step: {
      prompt: clean(input.selectorStep?.prompt ?? ""),
      rawResponse: clean(input.selectorStep?.rawResponse ?? ""),
      parsedSelector: clean(input.selectorStep?.parsedSelector ?? ""),
      kind: clean(input.selectorStep?.kind ?? ""),
      source: clean(input.selectorStep?.source ?? ""),
      latencyMs: input.selectorStep?.latencyMs ?? 0,
      errorClass: input.selectorStep?.errorClass
        ? clean(input.selectorStep.errorClass)
        : null,
    },
    note_gen_step: {
      sentenceCount: input.noteGenStep?.sentenceCount ?? 0,
      prompt: clean(input.noteGenStep?.prompt ?? ""),
      rawResponse: clean(input.noteGenStep?.rawResponse ?? ""),
      noteCount: input.noteGenStep?.noteCount ?? 0,
      latencyMs: input.noteGenStep?.latencyMs ?? 0,
      errorClass: input.noteGenStep?.errorClass
        ? clean(input.noteGenStep.errorClass)
        : null,
    },
    render_step: {
      dotsInjected: input.renderStep.dotsInjected,
      skippedNoPeriod: input.renderStep.skippedNoPeriod,
      skippedNoNote: input.renderStep.skippedNoNote,
    },
  };
}

export async function logSession(
  input: SessionTelemetryInput,
  opts: LogSessionOpts = {},
): Promise<void> {
  const supabaseUrl = opts.supabaseUrl ?? DOGFOOD_SUPABASE_URL;
  const anonKey = opts.anonKey ?? DOGFOOD_SUPABASE_ANON_KEY;
  if (opts.enabled === false) return;
  if (!supabaseUrl || !anonKey) return;

  const fetchFn = opts.fetchFn ?? fetch;
  const payload = buildSessionEvent(input);
  try {
    const resp = await fetchFn(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/sessions`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.warn("[jeom telemetry] Supabase insert failed:", resp.status);
    }
  } catch (err) {
    console.warn("[jeom telemetry] logSession failed:", err);
  }
}

export async function logClientEvent(
  input: ClientEventInput,
  opts: LogSessionOpts = {},
): Promise<void> {
  const supabaseUrl = opts.supabaseUrl ?? DOGFOOD_SUPABASE_URL;
  const anonKey = opts.anonKey ?? DOGFOOD_SUPABASE_ANON_KEY;
  if (opts.enabled === false) return;
  if (!supabaseUrl || !anonKey) return;

  const fetchFn = opts.fetchFn ?? fetch;
  const payload = {
    event_type: clean(input.eventType),
    ext_version: clean(input.extVersion),
    url: clean(input.url),
    details: cleanJson(input.details),
  };
  try {
    const resp = await fetchFn(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/client_events`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!resp.ok) {
      console.warn("[jeom telemetry] client event insert failed:", resp.status);
    }
  } catch (err) {
    console.warn("[jeom telemetry] logClientEvent failed:", err);
  }
}

function clean(value: string): string {
  return value.replace(SK_RE, "[redacted-key]").slice(0, FIELD_LIMIT);
}

function cleanJson<T>(value: T): T {
  return JSON.parse(clean(JSON.stringify(value))) as T;
}
