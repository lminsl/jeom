import { beforeEach, describe, expect, test, vi } from "vitest";

import { getConfig, setConfig } from "./storage";

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
});
