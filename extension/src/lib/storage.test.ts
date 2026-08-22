import { beforeEach, describe, expect, test, vi } from "vitest";

import { getConfig, getContentConfig, setConfig } from "./storage";

interface ChromeStorageArea {
  data: Record<string, unknown>;
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

function installChromeStorage(initial: Record<string, unknown> = {}): ChromeStorageArea {
  const area: ChromeStorageArea = {
    data: { ...initial },
    get: async (keys) =>
      Object.fromEntries(keys.map((key) => [key, area.data[key]])),
    set: async (patch) => {
      Object.assign(area.data, patch);
    },
  };
  vi.stubGlobal("chrome", { storage: { local: area } });
  return area;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("getConfig", () => {
  test("defaults diagnostic sharing off", async () => {
    installChromeStorage();

    const cfg = await getConfig();

    expect(cfg.shareDogfoodTelemetry).toBe(false);
  });

  test("persists diagnostic-sharing preference", async () => {
    const storage = installChromeStorage();

    await setConfig({ shareDogfoodTelemetry: false });
    const cfg = await getConfig();

    expect(cfg.shareDogfoodTelemetry).toBe(false);
    expect(storage.data.shareDogfoodTelemetry).toBe(false);
  });

  test("keeps legacy provider settings readable", async () => {
    installChromeStorage({
      llm: { provider: "anthropic", model: "haiku", apiKey: "sk-ant-old" },
    });

    const cfg = await getConfig();

    expect(cfg.llm).toMatchObject({
      provider: "anthropic",
      model: "haiku",
      apiKey: "sk-ant-old",
    });
  });

  test("removes the API key from content-script configuration", async () => {
    installChromeStorage({
      llm: { provider: "openrouter", model: "model", apiKey: "sk-or-secret" },
    });

    const cfg = await getContentConfig();

    expect(cfg.llm.apiKey).toBe("");
    expect(cfg.llm.provider).toBe("openrouter");
  });
});
