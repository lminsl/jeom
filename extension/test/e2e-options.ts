/** Provider-connection Settings e2e.
 *
 * Verifies the built extension renders every registry connection, switches
 * between hosted/custom/local requirements, and saves a keyless local setup.
 *
 * Usage: bun run test/e2e-options.ts
 */

import puppeteer from "puppeteer-core";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(DIRNAME, "..", "dist");
const PROFILE = "/tmp/jeom-options-e2e";
const SCREENSHOT = "/tmp/jeom-connections.png";
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main(): Promise<void> {
  if (existsSync(PROFILE)) await rm(PROFILE, { recursive: true, force: true });
  await mkdir(PROFILE, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_BIN,
    headless: false,
    pipe: true,
    enableExtensions: true,
    userDataDir: PROFILE,
    defaultViewport: { width: 1280, height: 1000, deviceScaleFactor: 1 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  try {
    const extensionId = await browser.installExtension(EXT_DIST);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await page.goto(
      `chrome-extension://${extensionId}/src/options/options.html`,
      { waitUntil: "load", timeout: 10_000 },
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll<HTMLSelectElement>(
          "#llmProvider option",
        ).length === 17,
      { timeout: 5_000 },
    );

    await page.screenshot({ path: SCREENSHOT, fullPage: true });

    const initial = await page.evaluate(() => ({
      providers: document.querySelectorAll("#llmProvider option").length,
      selected: (document.querySelector("#llmProvider") as HTMLSelectElement)
        .value,
      heading: document.querySelector("#providerName")?.textContent,
    }));
    if (
      initial.providers !== 17 ||
      initial.selected !== "openrouter" ||
      initial.heading !== "OpenRouter"
    ) {
      throw new Error(`Unexpected initial state: ${JSON.stringify(initial)}`);
    }

    await page.select("#llmProvider", "custom-openai");
    const custom = await page.evaluate(() => ({
      endpointHidden: (
        document.querySelector("#endpointWrap") as HTMLElement
      ).hidden,
      authHidden: (document.querySelector("#authWrap") as HTMLElement).hidden,
    }));
    if (custom.endpointHidden || custom.authHidden) {
      throw new Error(`Custom controls are hidden: ${JSON.stringify(custom)}`);
    }

    await page.select("#llmProvider", "ollama");
    const local = await page.evaluate(() => ({
      apiKeyHidden: (document.querySelector("#apiKeyWrap") as HTMLElement)
        .hidden,
      endpoint: (document.querySelector("#llmEndpoint") as HTMLInputElement)
        .value,
      model: (document.querySelector("#llmModel") as HTMLInputElement).value,
    }));
    if (
      !local.apiKeyHidden ||
      local.endpoint !== "http://localhost:11434/v1/chat/completions" ||
      local.model !== "llama3.2"
    ) {
      throw new Error(`Unexpected Ollama state: ${JSON.stringify(local)}`);
    }

    await page.click("#save");
    await page.waitForFunction(
      () => document.querySelector("#saved")?.textContent?.includes("Saved"),
      { timeout: 5_000 },
    );
    const saved = await page.evaluate(async () =>
      (await chrome.storage.local.get("llm")).llm,
    );
    if (
      saved.provider !== "ollama" ||
      saved.apiKey !== "" ||
      saved.model !== "llama3.2"
    ) {
      throw new Error(`Unexpected saved config: ${JSON.stringify(saved)}`);
    }

    console.log(`[e2e] PASS — 17 connections, custom controls, keyless local save`);
    console.log(`[e2e] screenshot: ${SCREENSHOT}`);
  } finally {
    await browser.close();
  }
}

await main();
