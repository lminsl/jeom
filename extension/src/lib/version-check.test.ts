import { describe, expect, test } from "vitest";

import { checkReleaseStatus, compareVersions } from "./version-check";

describe("compareVersions", () => {
  test("orders semver-like version strings", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("v1.0.0", "0.9.9")).toBe(1);
  });
});

describe("checkReleaseStatus", () => {
  test("reports outdated when current is below min supported", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify([
          {
            channel: "dogfood",
            latest_version: "0.2.0",
            min_supported_version: "0.2.0",
            update_url: "https://github.com/lminsl/jeom",
            message: "Update required.",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) satisfies typeof fetch;

    const status = await checkReleaseStatus("0.1.0", { fetchFn });

    expect(status?.outdated).toBe(true);
    expect(status?.latestVersion).toBe("0.2.0");
  });

  test("fails open when release config is unavailable", async () => {
    const fetchFn = (async () =>
      new Response(null, { status: 500 })) satisfies typeof fetch;

    await expect(checkReleaseStatus("0.1.0", { fetchFn })).resolves.toBeNull();
  });

  test("fails open when the network request rejects", async () => {
    const fetchFn = (async () => {
      throw new Error("offline");
    }) satisfies typeof fetch;

    await expect(checkReleaseStatus("0.1.0", { fetchFn })).resolves.toBeNull();
  });
});
