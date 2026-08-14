/** In-situ + Foundry e2e smoke test.
 *
 * Loads the dev build into Chrome via pipe-mode + Extensions.loadUnpacked,
 * writes config directly to chrome.storage.local (bypasses options page),
 * navigates to a corpus article, triggers ACTIVATE, and verifies:
 *   - selector LLM round-trip succeeded
 *   - notes came back
 *   - .ra-dot spans were injected in the live DOM
 *   - hovering a dot opens .ra-note popover
 *
 * Credentials: read from ~/Projects/.env at startup.
 *
 * Usage: bun run test/e2e-insitu.ts
 */

/// <reference types="chrome" />

import puppeteer, { type Browser } from "puppeteer-core";
import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(DIRNAME, "..", "dist");
function urlToSlug(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/[^a-z0-9]/gi, "-");
  const path = u.pathname.replace(/[^a-z0-9]/gi, "-").slice(0, 40);
  return `${host}${path}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
}
const URL_SLUG = urlToSlug(process.argv[2] ?? "https://blog.samaltman.com/what-i-wish-someone-had-told-me");
const PROFILE = `/tmp/ra-insitu-e2e-${URL_SLUG}`;
const SHOTS = resolve(DIRNAME, "..", "test-runs", "insitu-e2e", URL_SLUG);

const FAST = process.env.FAST === "1";
/** Launch the page, run the pipeline once, then keep the browser open
 *  for ~30 min (or until the user closes it) WITHOUT the auto-hover
 *  sequence — just dots in place, user drives. */
const INTERACTIVE = process.env.INTERACTIVE === "1";
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENV_PATH = "/Users/minjaekwon1/Projects/.env";
const DEFAULT_ARTICLE_URL = "https://blog.samaltman.com/what-i-wish-someone-had-told-me";
const ARTICLE_URL = process.argv[2] ?? DEFAULT_ARTICLE_URL;
const FOUNDRY_DEPLOYMENT = "claude-opus-4-7";

/** Sleep so the user has time to actually see what's happening on screen.
 *  In FAST=1 mode (parallel batch runs) this becomes a no-op. */
const SLOW = (ms: number, why: string): Promise<void> => {
  if (FAST) return Promise.resolve();
  console.log(`[slow] pausing ${ms}ms — ${why}`);
  return new Promise((r) => setTimeout(r, ms));
};

interface Env {
  OPENAI_API_KEY: string;
  ANTHROPIC_FOUNDRY_API_KEY: string;
  ANTHROPIC_FOUNDRY_TARGET_URI: string;
}

async function loadEnv(): Promise<Env> {
  const text = await readFile(ENV_PATH, "utf-8");
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] !== undefined && m[2] !== undefined) result[m[1]] = m[2];
  }
  const needed = [
    "OPENAI_API_KEY",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_TARGET_URI",
  ] as const;
  for (const k of needed) if (!result[k]) throw new Error(`Missing ${k} in ${ENV_PATH}`);
  return result as unknown as Env;
}

type E2EProvider = "anthropic-foundry" | "openai";

function e2eProvider(): E2EProvider {
  const raw = process.env.E2E_PROVIDER;
  if (raw === undefined || raw === "" || raw === "anthropic-foundry") {
    return "anthropic-foundry";
  }
  if (raw === "openai") return "openai";
  throw new Error(
    `Unsupported E2E_PROVIDER=${raw}. Expected "anthropic-foundry" or "openai".`,
  );
}

/** Run `fn` in the extension's service worker, re-fetching the worker each
 *  iteration so dormant SWs don't break the call. */
function makeSwEval(browser: Browser, extensionId: string) {
  return async function swEval<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown = new Error("swEval not attempted");
    for (let i = 0; i < 5; i++) {
      const target = browser
        .targets()
        .find(
          (t) =>
            t.type() === "service_worker" && t.url().includes(extensionId),
        );
      if (!target) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      const worker = await target.worker();
      if (!worker) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      try {
        return await worker.evaluate(fn);
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}

async function main(): Promise<void> {
  const env = await loadEnv();
  const provider = e2eProvider();

  if (existsSync(PROFILE)) await rm(PROFILE, { recursive: true, force: true });
  await mkdir(PROFILE, { recursive: true });
  await mkdir(SHOTS, { recursive: true });

  console.log("[e2e] launching Chrome 147 with pipe + enableExtensions…");
  const browser = await puppeteer.launch({
    executablePath: CHROME_BIN,
    headless: false,
    pipe: true,
    enableExtensions: true,
    userDataDir: PROFILE,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  try {
    console.log("[e2e] installing extension from", EXT_DIST);
    const extensionId = await browser.installExtension(EXT_DIST);
    console.log("[e2e] extension id =", extensionId);
    const swEval = makeSwEval(browser, extensionId);

    console.log("[e2e] writing config to chrome.storage.local…");
    const config =
      provider === "openai"
        ? {
            renderMode: "in-situ",
            llm: {
              provider: "openai",
              model: "gpt-5-mini",
              apiKey: env.OPENAI_API_KEY,
            },
          }
        : {
            renderMode: "in-situ",
            llm: {
              provider: "anthropic-foundry",
              model: FOUNDRY_DEPLOYMENT,
              apiKey: env.ANTHROPIC_FOUNDRY_API_KEY,
              endpoint: env.ANTHROPIC_FOUNDRY_TARGET_URI,
            },
          };
    const configJson = JSON.stringify(config);
    // Inline the literal JSON into the evaluated fn so it crosses the
    // worker boundary without an extra argument (some swEval / SW restart
    // races trip on argument serialization).
    await swEval(
      new Function(`return (async () => {
        await chrome.storage.local.set(${configJson});
      })()`) as () => Promise<void>,
    );

    console.log("[e2e] opening article:", ARTICLE_URL);
    const page = await browser.newPage();

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[reading-assistant]") || text.includes("[selector-llm]")) {
        console.log("  [page]", text);
      }
    });
    page.on("pageerror", (err: unknown) =>
      console.error(
        "  [page-error]",
        err instanceof Error ? err.message : String(err),
      ),
    );

    await page.goto(ARTICLE_URL, { waitUntil: "load", timeout: 60_000 });
    await SLOW(1500, "look at the raw article (no dots yet)");
    console.log("[e2e] reloading to force content-script inject…");
    await page.reload({ waitUntil: "load" });
    await page.bringToFront();
    await SLOW(1500, "page reloaded — about to trigger ACTIVATE");

    console.log("[e2e] triggering ACTIVATE (retry up to 10x if SW/content-script not ready; full run ~60s)");
    type ActivateResp =
      | { ok: true }
      | { ok: false; error?: string };
    let activateResp: ActivateResp = { ok: false, error: "not attempted" };
    for (let attempt = 1; attempt <= 10; attempt++) {
      const result = await swEval(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: "no active tab" } as const;
        try {
          const r = (await chrome.tabs.sendMessage(tab.id, {
            type: "ACTIVATE",
          })) as { ok: boolean; error?: string } | undefined;
          return r ?? ({ ok: false, error: "no response" } as const);
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          } as const;
        }
      });
      activateResp = result as ActivateResp;
      if (activateResp.ok) break;
      const err = "error" in activateResp ? activateResp.error ?? "" : "";
      if (err.includes("Receiving end does not exist")) {
        console.log(`[e2e] attempt ${attempt}: content script not yet registered, waiting 1s…`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      // Non-retryable error — surface it.
      break;
    }
    console.log("[e2e] activate response:", JSON.stringify(activateResp));

    if (!activateResp.ok) {
      await page.screenshot({ path: `${SHOTS}/error.png`, fullPage: true });
      throw new Error(
        `ACTIVATE failed: ${"error" in activateResp ? activateResp.error : "unknown"}`,
      );
    }

    console.log("[e2e] waiting for .ra-dot in page DOM…");
    await page.waitForSelector(".ra-dot", { timeout: 10_000 });
    const dotCount = await page.$$eval(".ra-dot", (els) => els.length);
    console.log("[e2e] dots injected:", dotCount);
    await SLOW(2500, "dots just appeared — look at them in the article");

    await page.screenshot({
      path: `${SHOTS}/01-with-dots.png`,
      fullPage: false,
    });
    console.log("[e2e] screenshot: 01-with-dots.png");

    let noteVisible = false;
    if (!INTERACTIVE) {
      console.log("[e2e] auto-hovering FIRST dot in 2s…");
      await SLOW(2000, "watch the first dot, the popover is about to open");
      await page.hover(".ra-dot");
      await new Promise((r) => setTimeout(r, 400));
      noteVisible = (await page.$(".ra-note")) !== null;
      console.log("[e2e] popover visible after hover:", noteVisible);
      if (noteVisible) {
        const typography = await page.evaluate(() => {
          const dot = document.querySelector(".ra-dot");
          const note = document.querySelector(".ra-note") as HTMLElement | null;
          if (!(dot instanceof HTMLElement) || note === null) {
            return null;
          }
          const textContainer =
            dot.closest("p, li, blockquote") ?? dot.parentElement;
          const dotStyle = getComputedStyle(dot);
          const containerStyle =
            textContainer instanceof Element
              ? getComputedStyle(textContainer)
              : null;
          return {
            dotFontSize: dotStyle.fontSize,
            containerFontSize: containerStyle?.fontSize ?? null,
            noteFontFamily: getComputedStyle(note).fontFamily,
            noteFontVariable: note.style.getPropertyValue(
              "--ra-note-font-family",
            ),
          };
        });
        console.log("[e2e] typography:", JSON.stringify(typography));
        if (typography === null) {
          throw new Error("Could not inspect marker typography after hover");
        }
        if (
          typography.containerFontSize !== null &&
          typography.dotFontSize !== typography.containerFontSize
        ) {
          throw new Error(
            `Dot font size ${typography.dotFontSize} did not inherit article text size ${typography.containerFontSize}`,
          );
        }
        const noteFontHasKoreanFallback =
          typography.noteFontVariable.includes('"Apple SD Gothic Neo"') ||
          typography.noteFontFamily.includes('"Apple SD Gothic Neo"');
        if (!noteFontHasKoreanFallback) {
          throw new Error(
            `Note font stack is missing Korean fallback: variable=${typography.noteFontVariable}; computed=${typography.noteFontFamily}`,
          );
        }
        await page.screenshot({
          path: `${SHOTS}/02-hover-note.png`,
          fullPage: false,
        });
        console.log("[e2e] screenshot: 02-hover-note.png");
      }
      await SLOW(4000, "popover open — read the note");

      console.log("[e2e] moving cursor off, then auto-hovering 3 more dots (middle / late / last)");
      await page.mouse.move(10, 10);
      await SLOW(1500, "popover should close — watch it disappear");

      const totalDots = dotCount;
      const dotIndices = [
        Math.floor(totalDots / 4),
        Math.floor(totalDots / 2),
        totalDots - 1,
      ].filter((i) => i > 0 && i < totalDots);

      const allDotHandles = await page.$$(".ra-dot");
      for (const idx of dotIndices) {
        const handle = allDotHandles[idx];
        if (!handle) continue;
        console.log(`[e2e] hover dot #${idx} of ${totalDots}…`);
        await handle.scrollIntoView();
        await SLOW(800, "scrolled to dot, about to hover");
        await handle.hover();
        await SLOW(3500, "look at popover position + content for this dot");
        await page.mouse.move(10, 10);
        await SLOW(800, "close");
      }
    }

    console.log("\n✅ SUCCESS");
    console.log(`   ${dotCount} dots injected`);
    if (!INTERACTIVE) {
      console.log(`   popover ${noteVisible ? "rendered ✓" : "MISSING ✗"} on hover`);
    }
    console.log(`   screenshots in ${SHOTS}/`);

    if (INTERACTIVE) {
      console.log("\n[e2e] INTERACTIVE mode — browser open for up to 30 min.");
      console.log("[e2e] Use the page freely (scroll, hover dots). Close the window or Ctrl+C to exit.");
      // Resolves when the browser is closed (user shuts the window) OR
      // after 30 min, whichever comes first.
      await Promise.race([
        new Promise<void>((r) => browser.once("disconnected", () => r())),
        new Promise<void>((r) => setTimeout(r, 30 * 60_000)),
      ]);
    } else if (!FAST) {
      console.log("\n[e2e] keeping browser open for 90s so you can scroll + hover freely.");
      console.log("[e2e] (close the window manually or wait — script will exit at 90s)");
      await new Promise((r) => setTimeout(r, 90_000));
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // Browser may already be closed (user shut the window in INTERACTIVE mode).
    }
  }
}

void main().catch((err: unknown) => {
  console.error(
    "\n❌ FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
});
