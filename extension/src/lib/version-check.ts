import {
  DOGFOOD_RELEASE_CHANNEL,
  DOGFOOD_SUPABASE_ANON_KEY,
  DOGFOOD_SUPABASE_URL,
} from "./dogfood-config";

export interface ReleaseStatus {
  channel: string;
  currentVersion: string;
  latestVersion: string;
  minSupportedVersion: string;
  updateUrl: string | null;
  message: string | null;
  outdated: boolean;
}

interface ReleaseRow {
  channel: string;
  latest_version: string;
  min_supported_version: string;
  update_url: string | null;
  message: string | null;
}

interface VersionCheckOpts {
  fetchFn?: typeof fetch;
  supabaseUrl?: string;
  anonKey?: string;
  channel?: string;
}

export async function checkReleaseStatus(
  currentVersion: string,
  opts: VersionCheckOpts = {},
): Promise<ReleaseStatus | null> {
  const supabaseUrl = opts.supabaseUrl ?? DOGFOOD_SUPABASE_URL;
  const anonKey = opts.anonKey ?? DOGFOOD_SUPABASE_ANON_KEY;
  const channel = opts.channel ?? DOGFOOD_RELEASE_CHANNEL;
  if (!supabaseUrl || !anonKey) return null;

  const fetchFn = opts.fetchFn ?? fetch;
  const url = new URL(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/extension_releases`,
  );
  url.searchParams.set(
    "select",
    "channel,latest_version,min_supported_version,update_url,message",
  );
  url.searchParams.set("channel", `eq.${channel}`);
  url.searchParams.set("limit", "1");

  const resp = await fetchFn(url.toString(), {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  }).catch(() => null);
  if (!resp) return null;
  if (!resp.ok) return null;

  const rows = (await resp.json()) as unknown;
  if (!Array.isArray(rows) || rows.length === 0 || !isReleaseRow(rows[0])) {
    return null;
  }

  const row = rows[0];
  return {
    channel: row.channel,
    currentVersion,
    latestVersion: row.latest_version,
    minSupportedVersion: row.min_supported_version,
    updateUrl: row.update_url,
    message: row.message,
    outdated: compareVersions(currentVersion, row.min_supported_version) < 0,
  };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const width = Math.max(left.length, right.length);
  for (let i = 0; i < width; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function parseVersion(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isReleaseRow(value: unknown): value is ReleaseRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<Record<keyof ReleaseRow, unknown>>;
  return (
    typeof row.channel === "string" &&
    typeof row.latest_version === "string" &&
    typeof row.min_supported_version === "string" &&
    (typeof row.update_url === "string" || row.update_url === null) &&
    (typeof row.message === "string" || row.message === null)
  );
}
