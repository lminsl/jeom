import { describe, expect, test } from "vitest";

import {
  buildSessionEvent,
  logClientEvent,
  logSession,
  type SessionTelemetryInput,
} from "./telemetry";

function sampleInput(): SessionTelemetryInput {
  return {
    url: "https://example.com/article?token=sk-urlsecret",
    title: "Example sk-titlesecret",
    extVersion: "0.1.0",
    userAgent: "vitest",
    llm: {
      provider: "openai",
      model: "gpt-5-mini",
      apiKey: "sk-api-secret",
    },
    selectorStep: {
      prompt: "selector prompt sk-selectorsecret",
      rawResponse: "article.post",
      parsedSelector: "article.post",
      kind: "found",
      source: "llm",
      latencyMs: 123,
      errorClass: null,
    },
    noteGenStep: {
      sentenceCount: 2,
      promptTemplate: "note template sk-templatesecret",
      prompt: "note prompt sk-notesecret",
      rawResponse: '{"sentences":[]}',
      noteCount: 1,
      latencyMs: 456,
      errorClass: null,
    },
    renderStep: {
      dotsInjected: 1,
      skippedNoPeriod: 0,
      skippedNoNote: 1,
    },
  };
}

describe("buildSessionEvent", () => {
  test("uses an explicit whitelist and redacts API-key-looking substrings", () => {
    const payload = buildSessionEvent(sampleInput());
    const serialized = JSON.stringify(payload);

    expect(hasKey(payload, "apiKey")).toBe(false);
    expect(serialized).not.toContain("sk-");
    expect(serialized).toContain("[redacted-key]");
  });

  test("caps large text fields at 50KB", () => {
    const input = sampleInput();
    input.noteGenStep = {
      ...input.noteGenStep!,
      prompt: "a".repeat(60_000),
      rawResponse: "b".repeat(60_000),
    };

    const payload = buildSessionEvent(input);

    expect(payload.note_gen_step.prompt).toHaveLength(50_000);
    expect(payload.note_gen_step.rawResponse).toHaveLength(50_000);
  });
});

describe("logSession", () => {
  test("uses the tracked dogfood Supabase config by default", async () => {
    let calledUrl = "";
    const fetchFn = (async (input) => {
      calledUrl = String(input);
      return new Response(null, { status: 201 });
    }) satisfies typeof fetch;

    await logSession(sampleInput(), { fetchFn });

    expect(calledUrl).toBe("https://pwjikamzdmhmlifnrhhx.supabase.co/rest/v1/sessions");
  });

  test("no-ops when explicitly disabled by blank config", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response(null, { status: 201 });
    }) satisfies typeof fetch;

    await logSession(sampleInput(), { supabaseUrl: "", anonKey: "", fetchFn });

    expect(called).toBe(false);
  });

  test("no-ops when telemetry sharing is disabled", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response(null, { status: 201 });
    }) satisfies typeof fetch;

    await logSession(sampleInput(), { enabled: false, fetchFn });

    expect(called).toBe(false);
  });
});

describe("logClientEvent", () => {
  test("redacts API-key-looking strings before insert", async () => {
    let body = "";
    const fetchFn = (async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 201 });
    }) satisfies typeof fetch;

    await logClientEvent(
      {
        eventType: "outdated_version",
        extVersion: "0.1.0",
        url: "https://example.com/sk-urlsecret",
        details: { message: "sk-detailsecret" },
      },
      { fetchFn },
    );

    expect(body).not.toContain("sk-");
    expect(body).toContain("[redacted-key]");
  });
});

function hasKey(value: unknown, key: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  return Object.values(value).some((item) => hasKey(item, key));
}
