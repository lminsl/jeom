/** Prompt Lab e2e.
 *
 * Runs a full local loop:
 *   1. open Prompt Lab
 *   2. load a mock article URL from the Prompt Lab page
 *   3. verify the URL-load path saved a local debug session
 *   4. edit the final note-generation prompt
 *   5. regenerate notes from the captured fixed sentence list
 *
 * The LLM endpoint is a local Anthropic-compatible mock, so this validates
 * extension wiring without spending tokens or depending on external network.
 *
 * Usage: bun run test/e2e-prompt-lab.ts
 */

/// <reference types="chrome" />

import puppeteer from "puppeteer-core";
import http from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(DIRNAME, "..", "dist");
const PROFILE = "/tmp/ra-prompt-lab-e2e";
const SHOTS = resolve(DIRNAME, "..", "test-runs", "prompt-lab");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROMPT_OVERRIDE = "CUSTOM_PROMPT_FOR_PROMPT_LAB_E2E";
const GOLD_NOTE = "Gold note that captures the intended reading move.";
const DRAFT_PROMPT = "UPDATED_PROMPT_FROM_GOLD_EXAMPLES";
const ARTICLE_SENTENCE_COUNT = 40;

const ARTICLE_HTML = `<!doctype html>
<html>
  <head><title>Prompt Lab Fixed Article</title></head>
  <body>
    <main>
      <article>
        <p>
          ${Array.from(
            { length: ARTICLE_SENTENCE_COUNT },
            (_, i) => `The fixed sentence number ${i + 1}.`,
          ).join(" ")}
        </p>
      </article>
    </main>
  </body>
</html>`;

interface RequestLog {
  method: string;
  url: string;
  body: string;
}

async function main(): Promise<void> {
  if (existsSync(PROFILE)) await rm(PROFILE, { recursive: true, force: true });
  await mkdir(PROFILE, { recursive: true });
  await mkdir(SHOTS, { recursive: true });

  const llmRequests: RequestLog[] = [];
  const llmServer = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "*",
      });
      res.end();
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      llmRequests.push({ method: req.method ?? "", url: req.url ?? "", body });
      let text = "article";
      if (body.includes("Gold examples")) {
        text = JSON.stringify({
          diagnosis: "The prompt missed the intended reading move.",
          patch: "Add a rule that follows the gold note's specificity.",
          draftPrompt: DRAFT_PROMPT,
        });
      } else if (body.includes("Sentences (numbered by global index)")) {
        text = JSON.stringify({
            sentences: [
              {
                global_index: 0,
                note: body.includes(PROMPT_OVERRIDE)
                  ? "Prompt Lab e2e regenerated note."
                  : "Baseline captured note.",
                why: "mock note generation",
                interaction: "hover",
              },
            ],
          });
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ content: [{ type: "text", text }] }));
    });
  });
  await new Promise<void>((resolve) => llmServer.listen(0, "127.0.0.1", resolve));
  const llmAddress = llmServer.address();
  if (llmAddress === null || typeof llmAddress === "string") {
    throw new Error("Failed to start mock LLM server.");
  }
  const mockEndpoint = `http://127.0.0.1:${llmAddress.port}/anthropic/v1/messages`;

  const articleServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(ARTICLE_HTML);
  });
  await new Promise<void>((resolve) =>
    articleServer.listen(0, "127.0.0.1", resolve),
  );
  const articleAddress = articleServer.address();
  if (articleAddress === null || typeof articleAddress === "string") {
    throw new Error("Failed to start article server.");
  }
  const articleUrl = `http://127.0.0.1:${articleAddress.port}/article`;

  const browser = await puppeteer.launch({
    executablePath: CHROME_BIN,
    headless: false,
    pipe: true,
    enableExtensions: true,
    userDataDir: PROFILE,
    defaultViewport: { width: 1440, height: 920 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  try {
    const extensionId = await browser.installExtension(EXT_DIST);
    console.log("[e2e] extension id =", extensionId);
    console.log("[e2e] mock endpoint =", mockEndpoint);
    console.log("[e2e] article =", articleUrl);

    const promptLabUrl = `chrome-extension://${extensionId}/src/prompt-lab/prompt-lab.html`;
    const labPage = await browser.newPage();
    await labPage.goto(promptLabUrl, { waitUntil: "load", timeout: 10_000 });
    await labPage.waitForSelector("#prompt-editor", { timeout: 5_000 });

    await labPage.evaluate(
      async (endpoint) => {
        await chrome.storage.local.set({
          developerMode: true,
          renderMode: "in-situ",
          shareDogfoodTelemetry: false,
          llm: {
            provider: "anthropic-foundry",
            model: "mock-deployment",
            apiKey: "mock-key",
            endpoint,
          },
        });
      },
      mockEndpoint,
    );

    await labPage.$eval(
      "#url-input",
      (el, value) => {
        const input = el as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      articleUrl,
    );
    await labPage.click("#load-url");
    await labPage.waitForFunction(
      () => document.getElementById("status")?.textContent === "Loaded",
      { timeout: 20_000 },
    );

    const capturedCount = await labPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(["promptLabDebugSessions"]);
      const sessions = stored.promptLabDebugSessions;
      return Array.isArray(sessions) ? sessions.length : 0;
    });
    console.log("[e2e] captured debug sessions:", capturedCount);

    const sentenceCount = await labPage.$eval(
      "#sentence-count",
      (el) => el.textContent ?? "",
    );
    const baselineVisible = await labPage.evaluate(() =>
      document.body.textContent?.includes("Baseline captured note.") ?? false,
    );
    console.log("[e2e] sentence count:", sentenceCount);
    console.log("[e2e] baseline visible:", baselineVisible);

    await labPage.$eval(
      "#prompt-editor",
      (el, value) => {
        const textarea = el as HTMLTextAreaElement;
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      },
      PROMPT_OVERRIDE,
    );
    await labPage.click("#generate");
    await labPage.waitForFunction(
      () => document.getElementById("status")?.textContent === "Done",
      { timeout: 10_000 },
    );

    const generatedVisible = await labPage.evaluate(() =>
      document.body.textContent?.includes("Prompt Lab e2e regenerated note.") ??
      false,
    );
    const runMeta = await labPage.$eval("#run-meta", (el) => el.textContent ?? "");
    await labPage.screenshot({
      path: `${SHOTS}/prompt-lab-generated.png`,
      fullPage: true,
    });

    const noteRequests = llmRequests.filter((request) =>
      request.body.includes("Sentences (numbered by global index)"),
    );
    const overrideRequest = noteRequests.find((request) =>
      request.body.includes(PROMPT_OVERRIDE),
    );
    const overrideHasFixedSentence =
      overrideRequest?.body.includes("The fixed sentence number 2.") === true;

    await labPage.$eval(
      '.gold-editor[data-sentence-key="0::0"]',
      (el, value) => {
        const textarea = el as HTMLTextAreaElement;
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      },
      GOLD_NOTE,
    );
    await labPage.click('.save-gold[data-sentence-key="0::0"]');
    await labPage.waitForFunction(
      () => document.getElementById("gold-count")?.textContent === "1 gold saved",
      { timeout: 5_000 },
    );
    await labPage.click("#improve-prompt");
    await labPage.waitForFunction(
      () =>
        document.getElementById("status")?.textContent ===
        "Prompt draft ready",
      { timeout: 10_000 },
    );
    const improvementVisible = await labPage.evaluate(() =>
      document.body.textContent?.includes("The prompt missed the intended reading move.") ??
      false,
    );
    const promptBeforeApply = await labPage.$eval(
      "#prompt-editor",
      (el) => (el as HTMLTextAreaElement).value,
    );
    const diffVisible = await labPage.evaluate(() => {
      const added = document.querySelector(".diff-added")?.textContent ?? "";
      const removed = document.querySelector(".diff-removed")?.textContent ?? "";
      return (
        added.includes("UPDATED_PROMPT_FROM_GOLD_EXAMPLES") &&
        removed.includes("CUSTOM_PROMPT_FOR_PROMPT_LAB_E2E")
      );
    });
    await labPage.click('[data-improvement-action="apply"]');
    await labPage.waitForFunction(
      () => document.getElementById("status")?.textContent === "Draft applied",
      { timeout: 5_000 },
    );
    const draftPromptApplied = await labPage.$eval(
      "#prompt-editor",
      (el) => (el as HTMLTextAreaElement).value,
    );
    const improverRequest = llmRequests.find((request) =>
      request.body.includes("Gold examples"),
    );
    const improverHasGold = improverRequest?.body.includes(GOLD_NOTE) === true;

    const leftToRightSync = await labPage.evaluate(async () => {
      function scrollRowToTop(container: HTMLElement, index: number): void {
        const row = container.querySelector<HTMLElement>(
          `[data-sentence-index="${index}"]`,
        );
        if (!row) throw new Error(`Missing row ${index}`);
        container.scrollTop = row.offsetTop - container.offsetTop;
      }
      function topVisibleIndex(container: HTMLElement): number | null {
        const top = container.getBoundingClientRect().top;
        const rows = Array.from(
          container.querySelectorAll<HTMLElement>("[data-sentence-index]"),
        );
        const row = rows.find(
          (candidate) => candidate.getBoundingClientRect().bottom >= top + 4,
        );
        const raw = row?.dataset.sentenceIndex;
        return raw === undefined ? null : Number(raw);
      }
      async function waitForSync(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const left = document.getElementById("sentences") as HTMLElement;
      const right = document.getElementById("output") as HTMLElement;
      scrollRowToTop(left, 20);
      await waitForSync();
      return {
        left: topVisibleIndex(left),
        right: topVisibleIndex(right),
      };
    });
    const rightToLeftSync = await labPage.evaluate(async () => {
      function scrollRowToTop(container: HTMLElement, index: number): void {
        const row = container.querySelector<HTMLElement>(
          `[data-sentence-index="${index}"]`,
        );
        if (!row) throw new Error(`Missing row ${index}`);
        container.scrollTop = row.offsetTop - container.offsetTop;
      }
      function topVisibleIndex(container: HTMLElement): number | null {
        const top = container.getBoundingClientRect().top;
        const rows = Array.from(
          container.querySelectorAll<HTMLElement>("[data-sentence-index]"),
        );
        const row = rows.find(
          (candidate) => candidate.getBoundingClientRect().bottom >= top + 4,
        );
        const raw = row?.dataset.sentenceIndex;
        return raw === undefined ? null : Number(raw);
      }
      async function waitForSync(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const left = document.getElementById("sentences") as HTMLElement;
      const right = document.getElementById("output") as HTMLElement;
      scrollRowToTop(right, 12);
      await waitForSync();
      return {
        left: topVisibleIndex(left),
        right: topVisibleIndex(right),
      };
    });

    console.log("[e2e] generated visible:", generatedVisible);
    console.log("[e2e] run meta:", runMeta);
    console.log("[e2e] llm requests:", llmRequests.length);
    console.log("[e2e] note requests:", noteRequests.length);
    console.log("[e2e] override request has fixed sentence:", overrideHasFixedSentence);
    console.log("[e2e] improvement visible:", improvementVisible);
    console.log("[e2e] diff visible:", diffVisible);
    console.log("[e2e] prompt unchanged before apply:", promptBeforeApply === PROMPT_OVERRIDE);
    console.log("[e2e] draft prompt applied:", draftPromptApplied === DRAFT_PROMPT);
    console.log("[e2e] improver request has gold:", improverHasGold);
    console.log("[e2e] left→right scroll sync:", JSON.stringify(leftToRightSync));
    console.log("[e2e] right→left scroll sync:", JSON.stringify(rightToLeftSync));
    console.log(`[e2e] screenshot: ${SHOTS}/prompt-lab-generated.png`);

    if (
      capturedCount !== 1 ||
      !sentenceCount.includes(`${ARTICLE_SENTENCE_COUNT} sentences`) ||
      !baselineVisible ||
      !generatedVisible ||
      !runMeta.includes(`1/${ARTICLE_SENTENCE_COUNT} notes`) ||
      noteRequests.length !== 2 ||
      !overrideRequest ||
      !overrideHasFixedSentence ||
      !improvementVisible ||
      !diffVisible ||
      promptBeforeApply !== PROMPT_OVERRIDE ||
      draftPromptApplied !== DRAFT_PROMPT ||
      !improverRequest ||
      !improverHasGold ||
      !indicesNear(leftToRightSync.left, 20) ||
      !indicesNear(leftToRightSync.right, 20) ||
      !indicesNear(rightToLeftSync.left, 12) ||
      !indicesNear(rightToLeftSync.right, 12)
    ) {
      throw new Error("Prompt Lab e2e assertions failed");
    }

    console.log(
      "\n✅ SUCCESS — Prompt Lab captures a session and regenerates from fixed sentences with prompt override",
    );
  } finally {
    await browser.close().catch(() => {
      // Browser may already be closed.
    });
    llmServer.close();
    articleServer.close();
  }
}

void main().catch((err: unknown) => {
  console.error(
    "\n❌ FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
});

function indicesNear(actual: number | null, expected: number): boolean {
  return actual !== null && Math.abs(actual - expected) <= 1;
}
