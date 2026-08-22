import { getConfig } from "../lib/storage";
import { providerNeedsApiKey } from "../lib/provider-registry";
import { logClientEvent } from "../lib/telemetry";
import { checkReleaseStatus, type ReleaseStatus } from "../lib/version-check";

const btn = document.getElementById("annotate-btn") as HTMLButtonElement;
const promptLabBtn = document.getElementById(
  "open-prompt-lab-btn",
) as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const logEl = document.getElementById("trace-log") as HTMLDivElement;
const optionsLink = document.getElementById("open-options") as HTMLAnchorElement;

let developerMode = false;
let releaseStatus: ReleaseStatus | null = null;

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  // chrome.runtime.openOptionsPage() silently fails on some Chrome 147/148
  // installs (despite the MV3 manifest options_ui being correct). Direct
  // tab open via chrome.runtime.getURL is the no-dependency fallback.
  chrome.tabs.create({
    url: chrome.runtime.getURL("src/options/options.html"),
  });
});

btn.addEventListener("click", () => void runActivate());
promptLabBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("src/prompt-lab/prompt-lab.html"),
  });
});

interface TraceLogMsg {
  type: "TRACE_LOG";
  msg: string;
}

function isTraceLog(x: unknown): x is TraceLogMsg {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { type?: unknown }).type === "TRACE_LOG"
  );
}

function appendTrace(text: string, kind: "trace" | "meta" = "trace"): void {
  const line = document.createElement("div");
  line.className = `line${kind === "meta" ? " meta" : ""}`;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

const SEND_RETRY_MAX = 5;
const SEND_RETRY_DELAY_MS = 500;

function isMissingReceiverError(msg: string): boolean {
  return msg.includes("Could not establish connection");
}

function isInjectableUrl(url: string | undefined): boolean {
  return (
    url?.startsWith("http://") === true ||
    url?.startsWith("https://") === true
  );
}

function contentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files?.length) {
    throw new Error(
      "Jeom content script is missing from the extension manifest.",
    );
  }
  return files;
}

async function injectContentScript(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.id) return false;
  if (!isInjectableUrl(tab.url)) {
    throw new Error("Jeom can only annotate normal http/https article pages.");
  }

  const files = contentScriptFiles();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files,
  });
  if (developerMode) {
    appendTrace(
      `— popup: injected content script fallback (${files.join(", ")})`,
      "meta",
    );
  }
  return true;
}

/** Send ACTIVATE; if the content script hasn't loaded yet, show a waiting
 *  status and retry up to N times. Other errors propagate. */
async function sendActivateWithRetry(
  tabId: number,
): Promise<{ ok: boolean; error?: string } | undefined> {
  let attemptedInjection = false;

  for (let attempt = 1; attempt <= SEND_RETRY_MAX; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: "ACTIVATE" })) as
        | { ok: boolean; error?: string }
        | undefined;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isMissingReceiverError(msg)) throw err;

      const tab = await chrome.tabs.get(tabId);
      if (!attemptedInjection && tab.status === "complete") {
        attemptedInjection = true;
        try {
          await injectContentScript(tab);
        } catch (injectErr) {
          const injectMsg =
            injectErr instanceof Error ? injectErr.message : String(injectErr);
          throw new Error(injectMsg);
        }
      }

      const stateLabel =
        tab.status === "loading"
          ? "Page still loading"
          : "Content script not ready yet";
      statusEl.textContent = `${stateLabel}… waiting (${attempt}/${SEND_RETRY_MAX})`;
      if (developerMode) {
        appendTrace(
          `— popup: send fail attempt ${attempt}/${SEND_RETRY_MAX} (tab.status=${tab.status}); retrying in ${SEND_RETRY_DELAY_MS}ms`,
          "meta",
        );
      }
      if (attempt === SEND_RETRY_MAX) {
        throw new Error(
          "Content script not loaded — try refreshing this page (or wait longer).",
        );
      }
      await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS));
    }
  }
  return undefined;
}

async function runActivate(): Promise<void> {
  statusEl.classList.remove("err");
  statusEl.textContent = "Annotating…";
  if (developerMode) appendTrace("— popup: ACTIVATE dispatched", "meta");

  if (releaseStatus?.outdated) {
    statusEl.textContent = updateRequiredMessage(releaseStatus);
    statusEl.classList.add("err");
    btn.disabled = true;
    return;
  }

  const cfg = await getConfig();
  if (providerNeedsApiKey(cfg.llm) && !cfg.llm.apiKey) {
    statusEl.textContent = "No API key set. Open Settings ↓";
    statusEl.classList.add("err");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusEl.textContent = "No active tab.";
    statusEl.classList.add("err");
    return;
  }

  btn.disabled = true;

  try {
    const resp = await sendActivateWithRetry(tab.id);
    if (resp?.ok) {
      statusEl.textContent = "Annotated ✓";
      if (developerMode) {
        appendTrace("— popup: ACTIVATE returned ok", "meta");
      } else {
        // Normal mode: close so the popup blink is near-invisible.
        window.close();
      }
    } else {
      statusEl.classList.add("err");
      statusEl.textContent = resp?.error || "Activation failed.";
      if (developerMode) {
        appendTrace(
          `— popup: ACTIVATE returned !ok: ${resp?.error ?? "(no error)"}`,
          "meta",
        );
      }
    }
  } catch (err) {
    statusEl.classList.add("err");
    const msg = err instanceof Error ? err.message : String(err);
    if (isMissingReceiverError(msg)) {
      statusEl.textContent =
        "Content script not loaded — try refreshing this page.";
    } else {
      statusEl.textContent = msg;
    }
    if (developerMode) appendTrace(`— popup: send error: ${msg}`, "meta");
  } finally {
    btn.disabled = false;
  }
}

// On open: pick up dev-mode flag, paint UI accordingly, then auto-fire
// ACTIVATE so the user doesn't have to click the button.
void (async () => {
  const cfg = await getConfig();
  developerMode = cfg.developerMode;
  if (developerMode) {
    document.body.classList.add("dev");
    chrome.runtime.onMessage.addListener((msg: unknown) => {
      if (isTraceLog(msg)) appendTrace(msg.msg);
    });
  }
  releaseStatus = await checkReleaseStatus(
    chrome.runtime.getManifest().version,
  );
  if (releaseStatus?.outdated && cfg.shareDogfoodTelemetry) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void logClientEvent({
      eventType: "outdated_version",
      extVersion: releaseStatus.currentVersion,
      url: tab?.url ?? "",
      details: {
        latestVersion: releaseStatus.latestVersion,
        minSupportedVersion: releaseStatus.minSupportedVersion,
        channel: releaseStatus.channel,
      },
    });
  }
  await runActivate();
})();

function updateRequiredMessage(status: ReleaseStatus): string {
  return (
    status.message ??
    `Update required. Current ${status.currentVersion}; latest ${status.latestVersion}. Run git pull, rebuild extension/, then reload Jeom in chrome://extensions.`
  );
}
