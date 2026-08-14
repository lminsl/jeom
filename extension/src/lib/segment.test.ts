import { describe, expect, test } from "vitest";

import {
  mergeFragments,
  segmentSentences,
  segmentSentencesWithDOM,
} from "./segment.ts";

function makeRoot(html: string): Element {
  const root = document.createElement("article");
  root.innerHTML = html;
  return root;
}

describe("segmentSentences (existing string-only path)", () => {
  test("splits at every period followed by whitespace or EOF", () => {
    expect(segmentSentences("One. Two. Three.")).toEqual(["One.", "Two.", "Three."]);
  });

  test("does not protect arbitrary short lowercase sentences", () => {
    expect(segmentSentences("one. two. three.")).toEqual(["one.", "two.", "three."]);
  });

  test("protects always-internal abbreviation periods before splitting", () => {
    expect(segmentSentences("Dr. Smith said hello.")).toEqual(["Dr. Smith said hello."]);
    expect(segmentSentences("Languages, e.g. Python, Rust, are popular.")).toEqual([
      "Languages, e.g. Python, Rust, are popular.",
    ]);
  });

  test("protects common abbreviation families before splitting", () => {
    expect(segmentSentences("Prof. Ada Lovelace met Capt. Nemo in Jan. 1843.")).toEqual([
      "Prof. Ada Lovelace met Capt. Nemo in Jan. 1843.",
    ]);
    expect(segmentSentences("Acme Inc. bought Example Co. yesterday.")).toEqual([
      "Acme Inc. bought Example Co. yesterday.",
    ]);
    expect(segmentSentences("See fig. 2 and ch. 4 for details.")).toEqual([
      "See fig. 2 and ch. 4 for details.",
    ]);
    expect(segmentSentences("The result, i.e. the final score, was surprising.")).toEqual([
      "The result, i.e. the final score, was surprising.",
    ]);
  });

  test("protects ambiguous abbreviations only on lowercase continuation", () => {
    expect(segmentSentences("He studied the U.S. economy closely.")).toEqual([
      "He studied the U.S. economy closely.",
    ]);
    expect(segmentSentences("He visited the U.S. The trip was fun.")).toEqual([
      "He visited the U.S.",
      "The trip was fun.",
    ]);
  });

  test("protects dotted acronyms before splitting", () => {
    expect(segmentSentences("A.I. systems are changing quickly.")).toEqual([
      "A.I. systems are changing quickly.",
    ]);
    expect(segmentSentences("A.I. The field changed.")).toEqual([
      "A.I.",
      "The field changed.",
    ]);
    expect(segmentSentences("He earned a Ph.D. before founding the lab.")).toEqual([
      "He earned a Ph.D. before founding the lab.",
    ]);
    expect(segmentSentences("He earned a Ph.D. The lab hired him.")).toEqual([
      "He earned a Ph.D.",
      "The lab hired him.",
    ]);
    expect(segmentSentences("The U.S.A. team won.")).toEqual(["The U.S.A. team won."]);
  });

  test("does not split inside decimals, URLs, or version numbers", () => {
    expect(
      segmentSentences("The 1.5 million users on example.com bought v1.2.3 today."),
    ).toEqual(["The 1.5 million users on example.com bought v1.2.3 today."]);
  });
});

describe("segmentSentencesWithDOM", () => {
  test("[1] simple <p> with two sentences in one text node", () => {
    const root = makeRoot("<p>One. Two.</p>");
    const tn = root.querySelector("p")!.firstChild as Text;

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(2);
    expect(out[0]!).toMatchObject({ paragraph: 0, sentence: 0, text: "One." });
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(3);
    expect(out[1]!).toMatchObject({ paragraph: 0, sentence: 1, text: "Two." });
    expect(out[1]!.periodNode).toBe(tn);
    expect(out[1]!.periodOffset).toBe(8);
  });

  test("[2] sentence spanning multiple text nodes via <em>", () => {
    const root = makeRoot("<p>One. Two with <em>emphasis</em> here. Three.</p>");
    const p = root.querySelector("p")!;
    const tn1 = p.childNodes[0] as Text;
    const tn3 = p.childNodes[2] as Text;

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(3);
    expect(out.map((s) => s.text)).toEqual(["One.", "Two with emphasis here.", "Three."]);
    expect(out[0]!.periodNode).toBe(tn1);
    expect(out[0]!.periodOffset).toBe(3);
    expect(out[1]!.periodNode).toBe(tn3);
    expect(out[1]!.periodOffset).toBe(5);
    expect(out[2]!.periodNode).toBe(tn3);
    expect(out[2]!.periodOffset).toBe(12);
  });

  test("[3] period right after a closing </a> lives in trailing text node", () => {
    const root = makeRoot('<p>Item: <a href="x">link text</a>. Next.</p>');
    const p = root.querySelector("p")!;
    const tn3 = p.childNodes[2] as Text;

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe("Item: link text.");
    expect(out[0]!.periodNode).toBe(tn3);
    expect(out[0]!.periodOffset).toBe(0);
    expect(out[1]!.text).toBe("Next.");
    expect(out[1]!.periodNode).toBe(tn3);
    expect(out[1]!.periodOffset).toBe(6);
  });

  test("[4] each <li> is its own paragraph", () => {
    const root = makeRoot("<ul><li>One.</li><li>Two.</li></ul>");
    const lis = root.querySelectorAll("li");
    const tn1 = lis[0]!.firstChild as Text;
    const tn2 = lis[1]!.firstChild as Text;

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(2);
    expect(out[0]!).toMatchObject({ paragraph: 0, sentence: 0, text: "One." });
    expect(out[0]!.periodNode).toBe(tn1);
    expect(out[0]!.periodOffset).toBe(3);
    expect(out[1]!).toMatchObject({ paragraph: 1, sentence: 0, text: "Two." });
    expect(out[1]!.periodNode).toBe(tn2);
    expect(out[1]!.periodOffset).toBe(3);
  });

  test("[5] paragraph with no terminal punctuation emits a sentence with null period info", () => {
    const root = makeRoot("<p>No terminator</p>");

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("No terminator");
    expect(out[0]!.periodNode).toBeNull();
    expect(out[0]!.periodOffset).toBeNull();
  });

  test("[6] protects Dr. abbreviation before splitting", () => {
    const root = makeRoot("<p>Dr. Smith said hello.</p>");
    const tn = root.querySelector("p")!.firstChild as Text;

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("Dr. Smith said hello.");
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(20);
  });

  test("[7] ! and ? terminate sentences", () => {
    const root = makeRoot("<p>Wait! What? Yes.</p>");
    const tn = root.querySelector("p")!.firstChild as Text;

    const out = segmentSentencesWithDOM(root);

    expect(out).toHaveLength(3);
    expect(out.map((s) => s.text)).toEqual(["Wait!", "What?", "Yes."]);
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(4);
    expect(out[1]!.periodNode).toBe(tn);
    expect(out[1]!.periodOffset).toBe(10);
    expect(out[2]!.periodNode).toBe(tn);
    expect(out[2]!.periodOffset).toBe(15);
  });

  test('[8] period inside a closing curly quote (`."`) terminates', () => {
    // #given a paragraph with a quoted phrase ending in `."` mid-paragraph
    const root = makeRoot('<p>She said “hello.” Then she left.</p>');
    const tn = root.querySelector("p")!.firstChild as Text;

    // #when
    const out = segmentSentencesWithDOM(root);

    // #then both sentences are detected; first period is at index 15 (`.` inside the quote)
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe("She said “hello.”");
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(15);
    expect(out[1]!.text).toBe("Then she left.");
    expect(out[1]!.periodNode).toBe(tn);
    expect(out[1]!.periodOffset).toBe(31);
  });

  test("[9] protects initials in names before splitting", () => {
    // #given prose with `Mr. J. R. R. Tolkien` style initials
    const root = makeRoot("<p>Mr. J. R. R. Tolkien wrote books.</p>");

    // #when
    const out = segmentSentencesWithDOM(root);

    // #then initials are not exposed as separate sentence candidates
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("Mr. J. R. R. Tolkien wrote books.");
  });

  test("[9b] protects multiple abbreviation families in DOM segmentation", () => {
    // #given a paragraph with titles, initials, Latin abbreviations, and corporate suffixes
    const root = makeRoot(
      "<p>Prof. A. B. Chen joined Acme Inc. in Jan. 2025, i.e. before launch.</p>",
    );
    const tn = root.querySelector("p")!.firstChild as Text;

    // #when
    const out = segmentSentencesWithDOM(root);

    // #then only the final period is exposed for marker placement
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(
      "Prof. A. B. Chen joined Acme Inc. in Jan. 2025, i.e. before launch.",
    );
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(66);
  });

  test("[9c] protects dotted acronyms in DOM segmentation", () => {
    // #given a paragraph with dotted acronyms / initialisms
    const root = makeRoot("<p>A.I. systems helped a Ph.D. researcher in the U.S.A. yesterday.</p>");
    const tn = root.querySelector("p")!.firstChild as Text;

    // #when
    const out = segmentSentencesWithDOM(root);

    // #then only the true sentence-ending period is exposed for marker placement
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(
      "A.I. systems helped a Ph.D. researcher in the U.S.A. yesterday.",
    );
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(62);
  });

  test("[9d] splits dotted acronyms before capitalized next sentence", () => {
    // #given a dotted acronym can be a complete sentence before a capitalized sentence
    const root = makeRoot("<p>A.I. The field changed. He earned a Ph.D. The lab hired him.</p>");
    const tn = root.querySelector("p")!.firstChild as Text;

    // #when
    const out = segmentSentencesWithDOM(root);

    // #then the final acronym periods are valid sentence boundaries
    expect(out.map((s) => s.text)).toEqual([
      "A.I.",
      "The field changed.",
      "He earned a Ph.D.",
      "The lab hired him.",
    ]);
    expect(out[0]!.periodNode).toBe(tn);
    expect(out[0]!.periodOffset).toBe(3);
    expect(out[2]!.periodNode).toBe(tn);
    expect(out[2]!.periodOffset).toBe(40);
  });

  test("[10] does not split inside decimals or URLs", () => {
    // #given prose with decimals, URLs, and version numbers
    const root = makeRoot(
      "<p>The 1.5 million users on example.com bought v1.2.3 today.</p>",
    );

    // #when
    const out = segmentSentencesWithDOM(root);

    // #then exactly one sentence — interior periods are protected because
    //       the next char is not whitespace
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(
      "The 1.5 million users on example.com bought v1.2.3 today.",
    );
  });
});

describe("mergeFragments", () => {
  // Tests use the full pipeline: segmentSentencesWithDOM → mergeFragments,
  // so they exercise real DOM-position tracking through the merge.

  test("[M1] 'Dr.' + capitalized name → merges to one sentence", () => {
    // #given the scrappy splitter produces two fragments
    const root = makeRoot("<p>Dr. Smith said hello.</p>");
    const tn = root.querySelector("p")!.firstChild as Text;

    // #when merge pass runs
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then they collapse and periodNode/Offset point to the FINAL period
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe("Dr. Smith said hello.");
    expect(merged[0]!.periodNode).toBe(tn);
    expect(merged[0]!.periodOffset).toBe(20);
  });

  test("[M2] 'Mr. J. R. R. Tolkien wrote books.' chained merges to one", () => {
    // #given five fragments from initials over-indexing
    const root = makeRoot("<p>Mr. J. R. R. Tolkien wrote books.</p>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then all five fragments collapse into one
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe("Mr. J. R. R. Tolkien wrote books.");
  });

  test("[M3] ambiguous abbreviation 'U.S.' followed by lowercase merges", () => {
    // #given U.S. ends a fragment, next starts with lowercase ('economy')
    const root = makeRoot("<p>He visited the U.S. economy directly.</p>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then merges (lowercase signals continuation)
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe("He visited the U.S. economy directly.");
  });

  test("[M4] ambiguous abbreviation 'U.S.' followed by capital stays split", () => {
    // #given U.S. ends a fragment, next starts with capital ('The') — could be
    // either a continuation or a new sentence; we prefer to over-index
    const root = makeRoot("<p>He visited the U.S. The trip was fun.</p>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then stays as two sentences (preserves the "scrappy / over-index" philosophy)
    expect(merged).toHaveLength(2);
    expect(merged[0]!.text).toBe("He visited the U.S.");
    expect(merged[1]!.text).toBe("The trip was fun.");
  });

  test("[M5] always-protected abbreviation 'e.g.' merges with following text", () => {
    // #given e.g. mid-sentence followed by more text
    const root = makeRoot("<p>Languages, e.g. Python, Rust, are popular.</p>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then merges to one sentence
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe("Languages, e.g. Python, Rust, are popular.");
  });

  test("[M5b] always-protected political titles merge with names", () => {
    // #given prose with title abbreviations before capitalized names
    const root = makeRoot(
      "<p>Sen. Bernie Sanders and Rep. Alexandria Ocasio-Cortez introduced it.</p>",
    );
    const tn = root.querySelector("p")!.firstChild as Text;

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then the title periods are not exposed as marker positions
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe(
      "Sen. Bernie Sanders and Rep. Alexandria Ocasio-Cortez introduced it.",
    );
    expect(merged[0]!.periodNode).toBe(tn);
    expect(merged[0]!.periodOffset).toBe(67);
  });

  test("[M5c] ambiguous abbreviation followed by capital remains split", () => {
    // #given U.S. can be a real sentence ending before a capitalized sentence
    const root = makeRoot("<p>He visited the U.S. The trip was fun.</p>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then the ambiguous abbreviation is preserved as a sentence end
    expect(merged.map((s) => s.text)).toEqual([
      "He visited the U.S.",
      "The trip was fun.",
    ]);
  });

  test("[M6] real consecutive sentences stay split", () => {
    // #given three legitimate sentences with no abbreviations
    const root = makeRoot("<p>One. Two. Three.</p>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then no merging happens
    expect(merged).toHaveLength(3);
    expect(merged.map((s) => s.text)).toEqual(["One.", "Two.", "Three."]);
  });

  test("[M7] fragments in different paragraphs never merge", () => {
    // #given an abbreviation at the end of one <li>, capital text starting next <li>
    const root = makeRoot("<ul><li>See Mr.</li><li>Then leave.</li></ul>");

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then no cross-paragraph merge — paragraphs are independent
    expect(merged).toHaveLength(2);
    expect(merged[0]!.paragraph).toBe(0);
    expect(merged[1]!.paragraph).toBe(1);
  });

  test("[M8] sentence indices renumbered within paragraph after merge", () => {
    // #given a paragraph that produces 5 raw fragments collapsing to 2 real sentences
    const root = makeRoot(
      "<p>Mr. Smith arrived. Dr. Jones left.</p>",
    );

    // #when
    const merged = mergeFragments(segmentSentencesWithDOM(root));

    // #then exactly two sentences, indices 0 and 1
    expect(merged).toHaveLength(2);
    expect(merged[0]!).toMatchObject({ paragraph: 0, sentence: 0, text: "Mr. Smith arrived." });
    expect(merged[1]!).toMatchObject({ paragraph: 0, sentence: 1, text: "Dr. Jones left." });
  });

  test("[M9] empty input returns empty output", () => {
    // #given no sentences
    // #when
    const merged = mergeFragments([]);
    // #then empty array
    expect(merged).toEqual([]);
  });
});
