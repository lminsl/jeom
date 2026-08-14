import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { mergeFragments, segmentSentencesWithDOM } from "../lib/segment";
import { injectMarkers, restoreExistingDots, wrapPeriodWithDot } from "./inject";
import { noteFontFamilyFromArticle } from "./note-popover";

function setBody(html: string): Element {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("injectMarkers — happy path", () => {
  test("injects a dot at every annotated sentence's period", () => {
    // #given a paragraph with two sentences, both annotated
    const root = setBody("<p>Sentence one. Sentence two.</p>");
    const sentences = segmentSentencesWithDOM(root);
    const notes = {
      "0::0": "note for the first sentence",
      "0::1": "note for the second sentence",
    };

    // #when markers are injected
    const handle = injectMarkers({ root, sentences, notes });

    // #then two dots appear, both inside the root
    expect(handle.dotsInjected).toBe(2);
    expect(root.querySelectorAll(".ra-dot")).toHaveLength(2);
  });

  test("does not inject dots into abbreviation periods", () => {
    // #given annotated sentences with abbreviations that contain internal periods
    const root = setBody(
      "<p>Sen. Bernie Sanders and Rep. Alexandria Ocasio-Cortez introduced it.</p><p>Languages, e.g. Python and Rust, are popular.</p>",
    );
    const sentences = mergeFragments(segmentSentencesWithDOM(root));
    const notes = {
      "0::0": "political title note",
      "1::0": "latin abbreviation note",
    };

    // #when markers are injected
    const handle = injectMarkers({ root, sentences, notes });

    // #then only the true sentence-ending periods are replaced
    expect(handle.dotsInjected).toBe(2);
    expect(root.querySelectorAll(".ra-dot")).toHaveLength(2);
    expect(root.innerHTML).toContain("Sen. Bernie Sanders");
    expect(root.innerHTML).toContain("Rep. Alexandria Ocasio-Cortez");
    expect(root.innerHTML).toContain("e.g. Python");
    expect(root.innerHTML).not.toContain("Sen<span");
    expect(root.innerHTML).not.toContain("Rep<span");
    expect(root.innerHTML).not.toContain("e.g<span");
  });

  test("stress: injects only terminal periods across mixed abbreviations", () => {
    // #given three annotated sentences with many internal abbreviation periods
    const root = setBody(
      "<p>Prof. A. B. Chen joined Acme Inc. in Jan. 2025, i.e. before launch.</p><p>He studied the U.S. economy, e.g. tariffs and jobs.</p><p>J. R. R. Tolkien research continues.</p>",
    );
    const sentences = mergeFragments(segmentSentencesWithDOM(root));
    const notes = {
      "0::0": "first",
      "1::0": "second",
      "2::0": "third",
    };

    // #when markers are injected
    const handle = injectMarkers({ root, sentences, notes });

    // #then exactly one dot lands per sentence, and abbreviation periods remain textual
    expect(handle.dotsInjected).toBe(3);
    expect(root.querySelectorAll(".ra-dot")).toHaveLength(3);
    expect(root.textContent).toContain("Prof. A. B. Chen");
    expect(root.textContent).toContain("Acme Inc.");
    expect(root.textContent).toContain("Jan. 2025");
    expect(root.textContent).toContain("i.e. before");
    expect(root.textContent).toContain("U.S. economy");
    expect(root.textContent).toContain("e.g. tariffs");
    expect(root.textContent).toContain("J. R. R. Tolkien");
    expect(root.innerHTML).not.toContain("Prof<span");
    expect(root.innerHTML).not.toContain("A<span");
    expect(root.innerHTML).not.toContain("B<span");
    expect(root.innerHTML).not.toContain("Inc<span");
    expect(root.innerHTML).not.toContain("Jan<span");
    expect(root.innerHTML).not.toContain("i.e<span");
    expect(root.innerHTML).not.toContain("U.S<span");
    expect(root.innerHTML).not.toContain("e.g<span");
    expect(root.innerHTML).not.toContain("J<span");
    expect(root.innerHTML).not.toContain("R<span");
  });

  test("skips sentences without a matching note", () => {
    // #given a three-sentence paragraph but only the middle sentence has a note
    const root = setBody("<p>First. Second. Third.</p>");
    const sentences = segmentSentencesWithDOM(root);
    const notes = { "0::1": "only the middle one" };

    // #when injected
    const handle = injectMarkers({ root, sentences, notes });

    // #then exactly one dot, with two skipped-no-note
    expect(handle.dotsInjected).toBe(1);
    expect(handle.skippedNoNote).toBe(2);
  });

  test("skips sentences whose periodNode is null (no terminator)", () => {
    // #given a sentence with no trailing punctuation
    const root = setBody("<p>An incomplete trailing sentence</p>");
    const sentences = segmentSentencesWithDOM(root);
    const notes = { "0::0": "a note" };

    // #when injected
    const handle = injectMarkers({ root, sentences, notes });

    // #then no dot is placed and the case is counted
    expect(handle.dotsInjected).toBe(0);
    expect(handle.skippedNoPeriod).toBe(1);
  });
});

describe("wrapPeriodWithDot — M variant invariants", () => {
  test("removes the period when there is no closing punctuation", () => {
    // #given a sentence whose period has no closing punctuation after it
    const root = setBody("<p>Hello world.</p>");
    const sentences = segmentSentencesWithDOM(root);
    expect(sentences).toHaveLength(1);

    // #when wrapped
    const ok = wrapPeriodWithDot(sentences[0]!, "note", root);

    // #then the dot is in the DOM and the period is gone from the text
    expect(ok).toBe(true);
    const p = root.querySelector("p")!;
    expect(p.querySelector(".ra-dot")).not.toBeNull();
    expect(p.textContent).not.toContain(".");
  });

  test("preserves a trailing closing quote (drops only the period)", () => {
    // #given a sentence ending with ." (period inside closing quote)
    const root = setBody('<p>He said "yes." Then left.</p>');
    const sentences = segmentSentencesWithDOM(root);

    // #when the first sentence's period is wrapped
    const ok = wrapPeriodWithDot(sentences[0]!, "note about quote", root);

    // #then injection succeeded and the closing quote survives
    expect(ok).toBe(true);
    const p = root.querySelector("p")!;
    expect(p.querySelector(".ra-dot")).not.toBeNull();
    expect(p.textContent).toContain('"');
  });

  test("dot carries the .ra-dot class for CSS targeting", () => {
    // #given a basic sentence
    const root = setBody("<p>Solo sentence.</p>");
    const sentences = segmentSentencesWithDOM(root);

    // #when wrapped
    wrapPeriodWithDot(sentences[0]!, "note", root);

    // #then the injected span has the expected class
    const dot = root.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot!.classList.contains("ra-dot")).toBe(true);
  });
});

describe("injectMarkers — lifecycle", () => {
  test("style element is injected once and idempotently", () => {
    // #given a basic paragraph
    const root = setBody("<p>Test.</p>");
    const sentences = segmentSentencesWithDOM(root);

    // #when injectMarkers runs twice
    injectMarkers({ root, sentences, notes: { "0::0": "n" } });
    injectMarkers({ root, sentences: segmentSentencesWithDOM(root), notes: { "0::0": "n" } });

    // #then only one style element is present
    expect(document.querySelectorAll("#ra-marker-style")).toHaveLength(1);
  });

  test("marker CSS keeps dots article-scaled and notes editorial", () => {
    // #when the source CSS is inspected directly
    const css = readFileSync("src/marker/marker.css", "utf8");

    // #then it favors host-sized punctuation and editorial note copy
    expect(css).toContain("width: 0.32em");
    expect(css).toContain("font-size: inherit");
    expect(css).toContain("--ra-note-font-family");
    expect(css).toContain("Charter");
    expect(css).toContain('"Apple SD Gothic Neo"');
  });

  test("popover font stack adapts to the annotated article text", () => {
    // #given a WSJ-like article font with a generic serif suffix
    const fontFamily = noteFontFamilyFromArticle("Exchange, Georgia, serif");

    // #then Korean fallbacks are inserted before the generic family
    expect(fontFamily).toBe(
      'Exchange, Georgia, "Apple SD Gothic Neo", "Noto Sans KR", serif',
    );
  });

  test("popover font stack falls back when the article only exposes a generic family", () => {
    // #given a site whose computed body font is just the generic serif
    const fontFamily = noteFontFamilyFromArticle("serif");

    // #then the CSS default editorial stack remains in charge
    expect(fontFamily).toBeNull();
  });

  test("hover note receives the dot's article font stack", () => {
    // #given an article root with an editorial serif stack
    const root = setBody('<p style="font-family: Georgia, serif;">One.</p>');
    injectMarkers({
      root,
      sentences: segmentSentencesWithDOM(root),
      notes: { "0::0": "note" },
    });

    // #when the user hovers the dot
    const dot = root.querySelector(".ra-dot")!;
    dot.dispatchEvent(new MouseEvent("mouseenter"));

    // #then the popover is told to match the article's text family
    const note = document.querySelector(".ra-note") as HTMLElement | null;
    expect(note).not.toBeNull();
    const noteFont = note!.style.getPropertyValue("--ra-note-font-family");
    expect(noteFont).toContain("Georgia");
    expect(noteFont).toContain('"Apple SD Gothic Neo"');
  });

  test("cleanup restores all dots to periods", () => {
    // #given an article with two annotated sentences
    const root = setBody("<p>One. Two.</p>");
    const sentences = segmentSentencesWithDOM(root);
    const handle = injectMarkers({
      root,
      sentences,
      notes: { "0::0": "a", "0::1": "b" },
    });

    // #when cleanup runs
    handle.cleanup();

    // #then no dots remain in the DOM and the consumed periods are restored
    expect(document.querySelectorAll(".ra-dot")).toHaveLength(0);
    expect(root.textContent).toBe("One. Two.");
  });

  test("cleanup removes the injected style element", () => {
    // #given an injection has occurred
    const root = setBody("<p>One.</p>");
    const sentences = segmentSentencesWithDOM(root);
    const handle = injectMarkers({ root, sentences, notes: { "0::0": "a" } });

    // #when cleanup runs
    handle.cleanup();

    // #then the style block is gone
    expect(document.getElementById("ra-marker-style")).toBeNull();
  });

  test("restoring existing dots before reactivation preserves sentence periods", () => {
    // #given a first injection replaced two periods with dots
    const root = setBody("<p>Old one. Old two.</p>");
    injectMarkers({
      root,
      sentences: segmentSentencesWithDOM(root),
      notes: { "0::0": "a", "0::1": "b" },
    });
    expect(document.querySelectorAll(".ra-dot")).toHaveLength(2);

    // #when content.ts normalizes a previously annotated page before
    // re-segmenting for a second activation
    restoreExistingDots();
    const sentences = segmentSentencesWithDOM(root);
    injectMarkers({
      root,
      sentences,
      notes: { "0::0": "a2", "0::1": "b2" },
    });

    // #then both dots can be placed again rather than disappearing
    expect(document.querySelectorAll(".ra-dot")).toHaveLength(2);
  });

  test("persistence observer re-injects dots after host page re-renders the article subtree", async () => {
    // #given a host article that will be restored from its own framework state
    const root = setBody("<p>One. Two.</p>");
    const originalHtml = root.innerHTML;

    // #when Jeom injects persistent markers
    const handle = injectMarkers({
      root,
      sentences: segmentSentencesWithDOM(root),
      notes: { "0::0": "a", "0::1": "b" },
      persist: { checkDelayMs: 0 },
    });
    expect(root.querySelectorAll(".ra-dot")).toHaveLength(2);

    // #and the host page wipes extension-owned spans by re-rendering the root
    root.innerHTML = originalHtml;
    expect(root.querySelectorAll(".ra-dot")).toHaveLength(0);
    await tick();
    await tick();

    // #then the observer re-segments the live DOM and restores the dots
    expect(root.querySelectorAll(".ra-dot")).toHaveLength(2);
    handle.cleanup();
  });

  test("cleanup disconnects the persistence observer", async () => {
    // #given persistent markers are active
    const root = setBody("<p>One. Two.</p>");
    const originalHtml = root.innerHTML;
    const handle = injectMarkers({
      root,
      sentences: segmentSentencesWithDOM(root),
      notes: { "0::0": "a", "0::1": "b" },
      persist: { checkDelayMs: 0 },
    });

    // #when cleanup runs before a host re-render
    handle.cleanup();
    root.innerHTML = originalHtml;
    await tick();
    await tick();

    // #then no background observer resurrects the annotations
    expect(document.querySelectorAll(".ra-dot")).toHaveLength(0);
  });
});
