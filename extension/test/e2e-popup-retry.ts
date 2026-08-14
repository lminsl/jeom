/** Popup retry-mechanism e2e (P1.16).
 *
 * Verifies that when ACTIVATE targets a non-annotatable extension page, the
 * popup:
 *   - attempts the send
 *   - classifies the page as unsupported instead of spinning forever
 *
 * Caveat: this can't reproduce real production toolbar-click flow because
 * puppeteer-core can't simulate that. Instead we open popup.html as a tab,
 * which makes the popup itself the active tab in its window — so its
 * chrome.tabs.query(active:true, currentWindow:true) targets itself. The
 * content script isn't there (chrome-extension://), and the injection fallback
 * should refuse it as a non-http(s) page.
 *
 * Usage: bun run test/e2e-popup-retry.ts
 */

/// <reference types="chrome" />

import puppeteer from "puppeteer-core";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(DIRNAME, "..", "dist");
const PROFILE = "/tmp/ra-popup-retry-e2e";
const SHOTS = resolve(DIRNAME, "..", "test-runs", "popup-retry");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main(): Promise<void> {
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
    const extensionId = await browser.installExtension(EXT_DIST);
    console.log("[e2e] extension id =", extensionId);

    // Need developer mode + a current-schema llm config so popup gets past
    // the "No API key" early-return and actually attempts the send.
    const setupPage = await browser.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
      waitUntil: "load",
      timeout: 10_000,
    });
    await setupPage.evaluate(async () => {
      await chrome.storage.local.set({
        renderMode: "in-situ",
        developerMode: true,
        llm: {
          provider: "openai",
          model: "gpt-5-mini",
          apiKey: "sk-test-not-used-popup-self-sends",
        },
      });
    });
    await setupPage.close();

    const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
    console.log("[e2e] opening popup as tab:", popupUrl);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/rest/v1/extension_releases")) {
        void req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              channel: "dogfood",
              latest_version: "0.2.0",
              min_supported_version: "0.2.0",
              update_url: "https://github.com/lminsl/jeom",
              message: null,
            },
          ]),
        });
        return;
      }
      void req.continue();
    });

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[reading-assistant]") || text.includes("popup")) {
        console.log("  [popup-page]", text);
      }
    });
    page.on("pageerror", (err: unknown) =>
      console.error(
        "  [page-error]",
        err instanceof Error ? err.message : String(err),
      ),
    );

    await page.goto(popupUrl, { waitUntil: "load", timeout: 10_000 });
    console.log("[e2e] popup loaded; watching status updates…");

    // Capture each distinct #status text as it changes.
    const statusHistory = await page.evaluate(async () => {
      const observed: string[] = [];
      const el = document.getElementById("status") as HTMLDivElement;
      let last = "";
      const tick = () => {
        const cur = el.textContent ?? "";
        if (cur !== last) {
          observed.push(cur);
          last = cur;
        }
      };
      tick();
      // Poll every 50ms for ~5s (retry budget = 5 × 500ms = 2.5s + slack)
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 50));
        tick();
      }
      return observed;
    });

    console.log("[e2e] status text history (deduped):");
    for (const s of statusHistory) console.log("  →", s);

    // Pull the trace-log DOM (dev mode is on, popup appends meta lines)
    const traceLines = await page.$$eval("#trace-log .line", (els) =>
      els.map((el) => el.textContent ?? ""),
    );
    console.log(`[e2e] trace-log lines: ${traceLines.length}`);
    for (const l of traceLines) console.log("  ◦", l);

    await page.screenshot({
      path: `${SHOTS}/popup-after-retries.png`,
      fullPage: true,
    });
    console.log("[e2e] screenshot: popup-after-retries.png");

    // --- Assertions ---
    const sawUnsupported = statusHistory.some((s) =>
      s.includes("normal http/https article pages"),
    );
    const sawSendError = traceLines.some((l) => l.includes("send error"));

    console.log("\n--- Assertions ---");
    console.log(`  sawUnsupported message : ${sawUnsupported ? "✅" : "❌"}`);
    console.log(`  sawSendError trace     : ${sawSendError ? "✅" : "❌"}`);

    if (sawUnsupported && sawSendError) {
      console.log("\n✅ SUCCESS — unsupported-page path behaves as designed");
    } else {
      console.log("\n❌ FAIL — see status history + trace lines above");
      process.exitCode = 1;
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // browser may already be closed
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
