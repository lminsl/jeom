import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildDomOutline,
  findArticleRoot,
  heuristicFallback,
  modelKey,
  normalizeSelectorResponse,
  safeQuerySelectorAll,
  type LLMConfig,
} from "./selector-llm.ts";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildDomOutline", () => {
  test("emits one line per element with tag, id, classes, char-count, p-count", () => {
    // #given a body with one <article class="post" id="p1"> containing two <p>
    setBody('<article id="p1" class="post"><p>Sentence one.</p><p>Sentence two.</p></article>');

    // #when
    const out = buildDomOutline(document.body);

    // #then the article line includes id, class, char-count and p-count
    const lines = out.split("\n");
    const articleLine = lines.find((l) => l.includes("<article"));
    expect(articleLine).toBeDefined();
    expect(articleLine).toContain("#p1");
    expect(articleLine).toContain(".post");
    expect(articleLine).toContain("p=2");
  });

  test("excludes script, style, svg, noscript, link, meta tags", () => {
    // #given a body containing tags that should be skipped
    setBody('<script>x</script><style>y</style><svg></svg><noscript></noscript><div>visible</div>');

    // #when
    const out = buildDomOutline(document.body);

    // #then none of the skip-tags appear in the outline
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<noscript");

    // #and the visible div does appear
    expect(out).toContain("<div");
  });

  test("truncates beyond max depth (7 levels)", () => {
    // #given a body nested 10 levels deep with a unique id at the deepest level
    let html = '<div id="L0">';
    for (let i = 1; i <= 9; i++) html += `<div id="L${i}">`;
    html += '<span id="DEEPEST">x</span>';
    for (let i = 0; i <= 9; i++) html += "</div>";
    setBody(html);

    // #when
    const out = buildDomOutline(document.body);

    // #then the deeply-nested span is not present (depth cap kicks in)
    expect(out).not.toContain("DEEPEST");
  });

  test("preview text is truncated at 70 chars with ellipsis", () => {
    // #given a <p> with text well over 70 chars
    const longText = "a".repeat(150);
    setBody(`<p>${longText}</p>`);

    // #when
    const out = buildDomOutline(document.body);

    // #then the line contains the ellipsis sentinel
    expect(out).toContain("…");
  });

  test("uses ASCII tag-with-classes notation (matches the prompt grammar)", () => {
    // #given a div with two classes and an id
    setBody('<div class="c1 c2 c3" id="x">hello</div>');

    // #when
    const out = buildDomOutline(document.body);

    // #then the format is <tag#id.c1.c2.c3>
    expect(out).toMatch(/<div#x\.c1\.c2\.c3>/);
  });
});

describe("normalizeSelectorResponse", () => {
  test("returns clean selector unchanged", () => {
    // #given a clean selector
    // #when normalized
    // #then it's identical
    expect(normalizeSelectorResponse("div.post")).toBe("div.post");
  });

  test("strips surrounding whitespace", () => {
    // #given padded input
    // #when normalized
    // #then whitespace is gone
    expect(normalizeSelectorResponse("  div.post  ")).toBe("div.post");
  });

  test("strips backticks the model sometimes adds", () => {
    // #given backtick-wrapped input
    // #when normalized
    // #then the backticks are stripped
    expect(normalizeSelectorResponse("`div.post`")).toBe("div.post");
  });

  test("strips double quotes", () => {
    // #given double-quote-wrapped input
    // #when normalized
    // #then the quotes are stripped
    expect(normalizeSelectorResponse('"div.post"')).toBe("div.post");
  });

  test("strips markdown-style code fences", () => {
    // #given triple-backtick fenced input
    // #when normalized
    // #then the fences are stripped
    expect(normalizeSelectorResponse("```div.post```")).toBe("div.post");
  });

  test("preserves NONE sentinel", () => {
    // #given the LLM's refusal sentinel
    // #when normalized
    // #then NONE is preserved verbatim
    expect(normalizeSelectorResponse("NONE")).toBe("NONE");
  });

  test("returns empty string for whitespace-only input", () => {
    // #given only whitespace
    // #when normalized
    // #then the result is empty
    expect(normalizeSelectorResponse("   \n\t  ")).toBe("");
  });
});

describe("safeQuerySelectorAll", () => {
  test("returns matching elements for valid selector", () => {
    // #given a document with two matching elements
    setBody('<div class="x">a</div><div class="x">b</div>');

    // #when queried
    const els = safeQuerySelectorAll(document, ".x");

    // #then both are returned
    expect(els).toHaveLength(2);
  });

  test("returns empty array when selector matches nothing", () => {
    // #given a document without the target class
    setBody("<div>hello</div>");

    // #when queried for a missing class
    const els = safeQuerySelectorAll(document, ".not-here");

    // #then the result is an empty array (not null, not throw)
    expect(els).toEqual([]);
  });

  test("returns empty array for invalid CSS without throwing", () => {
    // #given a syntactically invalid CSS selector
    setBody("<div>x</div>");

    // #when queried with garbage
    const els = safeQuerySelectorAll(document, "this is not valid css [[[");

    // #then no throw, empty array
    expect(els).toEqual([]);
  });
});

describe("heuristicFallback", () => {
  test("picks <article> first", () => {
    // #given a document with both <article> and <main>
    setBody('<main><p>main content</p></main><article><p>article content</p></article>');

    // #when fallback runs
    const result = heuristicFallback(document);

    // #then the <article> wins and source is heuristic-fallback
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("expected found");
    expect(result.selector).toBe("article");
    expect(result.source).toBe("heuristic-fallback");
  });

  test("picks <main> when no <article>", () => {
    // #given only a <main>
    setBody('<main><p>main content here</p></main>');

    // #when fallback runs
    const result = heuristicFallback(document);

    // #then <main> is chosen
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("expected found");
    expect(result.selector).toBe("main");
  });

  test("picks [role='main'] when neither <article> nor <main>", () => {
    // #given only a role="main" container
    setBody('<div role="main"><p>roled content</p></div>');

    // #when fallback runs
    const result = heuristicFallback(document);

    // #then the role selector is chosen
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("expected found");
    expect(result.selector).toBe('[role="main"]');
  });

  test("falls back to largest-text div when no semantic container exists", () => {
    // #given only generic divs, the larger of which has > 200 chars
    const big = "x".repeat(500);
    setBody(`<div>short</div><div>${big}</div>`);

    // #when fallback runs
    const result = heuristicFallback(document);

    // #then the result is found via the largest-text sentinel
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("expected found");
    expect(result.selector).toBe("<heuristic:largest-text>");
    expect(result.roots).toHaveLength(1);
  });

  test("returns not-an-article when no usable container exists", () => {
    // #given a body with only short, generic content (under largest-text threshold)
    setBody("<p>tiny</p>");

    // #when fallback runs
    const result = heuristicFallback(document);

    // #then no article found, the graceful refusal is emitted
    expect(result.kind).toBe("not-an-article");
    if (result.kind !== "not-an-article") throw new Error("expected not-an-article");
    expect(result.reason).toBe("heuristic-empty");
  });
});

describe("modelKey", () => {
  test("formats anthropic providers as 'anthropic:<model>'", () => {
    // #given an anthropic config
    const cfg: LLMConfig = { provider: "anthropic", model: "haiku", apiKey: "x" };

    // #when keyed
    // #then the format is provider:model
    expect(modelKey(cfg)).toBe("anthropic:haiku");
  });

  test("formats openai providers as 'openai:<model>'", () => {
    // #given an openai config
    const cfg: LLMConfig = { provider: "openai", model: "gpt-5-mini", apiKey: "x" };

    // #when keyed
    // #then the format is provider:model
    expect(modelKey(cfg)).toBe("openai:gpt-5-mini");
  });
});

describe("findArticleRoot", () => {
  test("falls back to a semantic root when the LLM falsely returns NONE", async () => {
    // #given an article page where the LLM is over-conservative
    setBody("<article><p>Sentence one.</p><p>Sentence two.</p></article>");
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true, text: "NONE" }),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    // #when
    const result = await findArticleRoot({
      document,
      url: "https://example.com/article",
      llm: { provider: "openai", model: "gpt-5-mini", apiKey: "x" },
    });

    // #then the deterministic article fallback keeps the page usable
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("expected found");
    expect(result.selector).toBe("article");
    expect(result.source).toBe("heuristic-fallback");
  });
});
