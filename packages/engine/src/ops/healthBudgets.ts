import { inflateRawSync } from "node:zlib";
import { redact } from "../context.js";
import type { CardArea, CardRow, CardTone } from "../store/healthStore.js";
import type { VitalSummary } from "../store/vitalsStore.js";
import type { Check } from "./doctorTypes.js";
import type { DeploymentReading, HealthAspect, PerfPage, Sink } from "./healthChecks.js";

/**
 * The budgets `singularity health` guards (D360): Neon's compute hours, the nightly browser suite,
 * the keys, and the Monday card that puts every area on one line. Each reader never throws: a
 * failure is a reading that says why, with the key taken out of it.
 */

const DAY_MS = 86_400_000;
const TIMEOUT_MS = 20_000;
type Read<T> = T | { error: string };

function message(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
}

// ---- Neon compute ----------------------------------------------------------------------------

/** The free plan's compute a month, in CU-hours; the project stops at it. */
export const NEON_CU_HOURS_CAP = 100;
/** A pace (the period's use at this rate) over this is a warning. */
export const NEON_PACE_WARN = 70;
/** A pace over this, or this much used, is a fault: a week's notice before the cap. */
export const NEON_PACE_FAULT = 85;
export const NEON_USED_FAULT = 80;

/** CU-hours used this period, and the period's total at this rate. */
export type NeonReading = { used: number; pace: number } | { error: string };

/**
 * Reads the project's consumption this period. A project-scoped key cannot list projects (GET
 * /projects answers 404), so the project is named by NEON_PROJECT_ID.
 */
export async function readNeonCompute(
  key: string | undefined,
  id: string | undefined,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<NeonReading> {
  if (!key || !id) return { error: "NEON_API_KEY or NEON_PROJECT_ID is not set" };
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const response = await fetcher(`https://console.neon.tech/api/v2${path}`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 200) throw new Error(`Neon answered ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };
  try {
    const project = (await get(`/projects/${encodeURIComponent(id)}`)).project as
      | Record<string, unknown>
      | undefined;
    const seconds = Number(project?.compute_time_seconds);
    const start = Date.parse(String(project?.consumption_period_start));
    const end = Date.parse(String(project?.consumption_period_end));
    if (!Number.isFinite(seconds) || !(end > start)) {
      throw new Error("the project has no compute time for its period");
    }
    const used = seconds / 3600;
    // At least a day counts as elapsed, so the period's first hours do not project one burst over the month.
    const elapsed = Math.min(1, Math.max(now.getTime() - start, DAY_MS) / (end - start));
    return { used, pace: used / elapsed };
  } catch (error) {
    return { error: redact(message(error), [key]) };
  }
}

/** `neon_compute`: the period's pace against the free plan; `neon_unmeasured` when it did not read. */
export function checkNeonCompute(reading: NeonReading, sink: Sink): void {
  if ("error" in reading) {
    sink.warn(
      "neon_unmeasured",
      "cost",
      `Neon's compute hours did not read: ${reading.error}. The free plan's ${NEON_CU_HOURS_CAP} CU-hours a month go unwatched.`,
    );
    return;
  }
  const line = `Neon has used ${reading.used.toFixed(1)} CU-hours this period, a pace of ${Math.round(reading.pace)}; the free plan stops the database at ${NEON_CU_HOURS_CAP}.`;
  if (reading.pace > NEON_PACE_FAULT || reading.used > NEON_USED_FAULT) {
    sink.fault("neon_compute", "cost", `${line} Find what keeps it awake.`);
  } else if (reading.pace > NEON_PACE_WARN) {
    sink.warn("neon_compute", "cost", line);
  } else {
    sink.passed.push(line);
  }
}

// ---- GitHub ----------------------------------------------------------------------------------

/** The artifact browser.yml uploads the site suite's JSON report under (playwright.config.ts). */
export const BROWSER_RESULTS_ARTIFACT = "browser-results";
const API = "https://api.github.com";

/** A workflow's finished runs this week that passed or failed, and their median length. */
export interface SuiteWeek {
  passed: number;
  failed: number;
  median_ms: number | null;
}

export interface GitHubReading {
  /** The conclusions of this week's finished scheduled browser.yml runs on main, newest first. */
  nightly: Read<string[]>;
  suites: Record<"browser.yml" | "ci.yml", Read<SuiteWeek>>;
  /** Open issues created over 7 days ago. */
  old_issues: Read<number>;
  /** Open Dependabot alerts; an error when the token may not read them. */
  dependabot: Read<number>;
  /** Tests that passed only on a retry in the newest main run's report; null when none is kept. */
  flaky: Read<number | null>;
}

interface GitHubRun {
  event?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  created_at: string;
  run_started_at?: string;
  updated_at?: string;
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

function suiteWeek(runs: Read<GitHubRun[]>): Read<SuiteWeek> {
  if ("error" in runs) return runs;
  const done = runs.filter(
    (run) => run.conclusion === "success" || FAILED.has(run.conclusion ?? ""),
  );
  const lengths = done
    .map((run) => Date.parse(run.updated_at ?? "") - Date.parse(run.run_started_at ?? ""))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  return {
    passed: done.filter((run) => run.conclusion === "success").length,
    failed: done.length - done.filter((run) => run.conclusion === "success").length,
    median_ms:
      lengths.length === 0
        ? null
        : lengths.length % 2
          ? (lengths[mid] as number)
          : ((lengths[mid - 1] as number) + (lengths[mid] as number)) / 2,
  };
}

/**
 * The first file of a zip (an Actions artifact holds one: the report). Reads the central directory,
 * as the upload writes sizes after the data. shortcut: no zip64, fine for a report under 4 GB.
 */
export function firstZipEntry(zip: Uint8Array): string {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("the artifact is not a zip");
  const central = view.getUint32(end + 16, true);
  if (view.getUint32(central, true) !== 0x02014b50) throw new Error("the artifact's zip is broken");
  const method = view.getUint16(central + 10, true);
  const size = view.getUint32(central + 20, true);
  const local = view.getUint32(central + 42, true);
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = zip.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(data) : Buffer.from(data)).toString("utf8");
}

/**
 * The week on GitHub with the Actions token: browser.yml's and ci.yml's runs, issues open over a
 * week, open Dependabot alerts and the newest main run's flaky count. Undefined without a token or
 * a repository (a local run); each part that fails is an error of its own.
 */
export async function readGitHub(
  token: string | undefined,
  repo: string | undefined,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<GitHubReading | undefined> {
  if (!token || !repo) return undefined;
  const get = async (url: string): Promise<Response> => {
    // The token goes to GitHub's API only; a download redirect drops it.
    if (!url.startsWith(`${API}/`)) throw new Error("GitHub named a link off its API");
    const response = await fetcher(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "singularity-health",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 200) throw new Error(`GitHub answered ${response.status}`);
    return response;
  };
  const read = async <T>(work: () => Promise<T>): Promise<Read<T>> => {
    try {
      return await work();
    } catch (error) {
      return { error: redact(message(error), [token]) };
    }
  };
  const base = `${API}/repos/${repo}`;
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
  // shortcut: one page, the newest 100 runs of the week; page on once ci.yml runs more than that.
  const runs = (file: string, filter = "") =>
    read(async () => {
      const body = (await (
        await get(
          `${base}/actions/workflows/${file}/runs?created=%3E%3D${since}&per_page=100${filter}`,
        )
      ).json()) as { workflow_runs?: GitHubRun[] };
      return body.workflow_runs ?? [];
    });
  const [browser, nightly, ci, issues, alerts, flaky] = await Promise.all([
    runs("browser.yml"),
    // Asked apart: a week of pushes to main fills the first page and would hide the nightlies.
    runs("browser.yml", "&event=schedule&branch=main&status=completed"),
    runs("ci.yml"),
    read(async () => {
      const list = (await (
        await get(`${base}/issues?state=open&per_page=100&sort=created&direction=asc`)
      ).json()) as Array<{
        created_at: string;
        pull_request?: unknown;
      }>;
      return list.filter(
        (issue) => !issue.pull_request && now.getTime() - Date.parse(issue.created_at) > 7 * DAY_MS,
      ).length;
    }),
    read(
      async () =>
        (
          (await (
            await get(`${base}/dependabot/alerts?state=open&per_page=100`)
          ).json()) as unknown[]
        ).length,
    ),
    read(async () => {
      const { artifacts } = (await (
        await get(`${base}/actions/artifacts?name=${BROWSER_RESULTS_ARTIFACT}&per_page=20`)
      ).json()) as {
        artifacts?: Array<{
          expired?: boolean;
          archive_download_url?: string;
          workflow_run?: { head_branch?: string };
        }>;
      };
      const newest = artifacts?.find(
        (each) => !each.expired && each.workflow_run?.head_branch === "main",
      );
      if (!newest?.archive_download_url) return null;
      const zip = new Uint8Array(await (await get(newest.archive_download_url)).arrayBuffer());
      const flakyCount = (JSON.parse(firstZipEntry(zip)) as { stats?: { flaky?: unknown } }).stats
        ?.flaky;
      if (typeof flakyCount !== "number") throw new Error("the report has no flaky count");
      return flakyCount;
    }),
  ]);
  return {
    nightly:
      "error" in nightly
        ? nightly
        : nightly
            .filter(
              (run) =>
                run.event === "schedule" &&
                run.head_branch === "main" &&
                run.status === "completed",
            )
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            .map((run) => run.conclusion ?? ""),
    suites: { "browser.yml": suiteWeek(browser), "ci.yml": suiteWeek(ci) },
    old_issues: issues,
    dependabot: alerts,
    flaky,
  };
}

/**
 * `browser_suite_failed`: the last two nightly browser.yml runs on main failed. One failure may be
 * the runner; two nights running, the layout, the player or the suite is broken and every push
 * since went unchecked by it. A list that did not read is `github_unread`.
 */
export function checkBrowserSuite(reading: GitHubReading, sink: Sink): void {
  if ("error" in reading.nightly) {
    sink.warn(
      "github_unread",
      "quality",
      `browser.yml's runs did not read: ${reading.nightly.error}. The nightly suite goes unwatched.`,
    );
    return;
  }
  const [last, before] = reading.nightly;
  if (last === undefined) {
    // A schedule GitHub switched off, or a broken file, leaves the detector nothing to judge.
    sink.warn(
      "browser_nightly_missing",
      "quality",
      "No nightly browser.yml run on main finished this week: its schedule may be off.",
    );
    return;
  }
  if (FAILED.has(last ?? "") && FAILED.has(before ?? "")) {
    sink.fault(
      "browser_suite_failed",
      "quality",
      "The last two nightly browser.yml runs on main failed: the site's layout or player is broken, or the suite is. Its traces are on the run.",
    );
  } else {
    sink.passed.push(`the last nightly browser suite ended ${last}`);
  }
}

// ---- keys ------------------------------------------------------------------------------------

/** A token with fewer days left than this is a fault: two weeks to make and push a new one. */
export const KEY_EXPIRY_FAULT_DAYS = 14;

/**
 * Doctor's free key checks, daily: a key a service refused is `key_rejected` and a token near its
 * end `token_expiring`, both faults; a service busy is `key_unchecked`, a warning; an unset key is skipped.
 */
export function checkKeys(checks: readonly Check[], sink: Sink): void {
  for (const check of checks) {
    const line = `${check.id.replace(/^online\./, "")}: ${check.summary}.${check.hint ? ` ${check.hint}` : ""}`;
    if (check.expiresInDays !== undefined && check.expiresInDays < KEY_EXPIRY_FAULT_DAYS) {
      sink.fault("token_expiring", "security", line);
    } else if (check.status === "fail" && !check.unreachable) {
      sink.fault("key_rejected", "security", line);
    } else if (
      check.unreachable ||
      (check.status === "warn" && !check.summary.startsWith("skipped"))
    ) {
      // An unset key is a choice (an optional provider), not a key in trouble.
      sink.warn("key_unchecked", "security", line);
    }
  }
  const fine = checks.filter((check) => check.status === "ok").length;
  if (fine > 0) sink.passed.push(`${fine} of ${checks.length} keys answer`);
}

// ---- the card --------------------------------------------------------------------------------

const AREAS: ReadonlyArray<[CardArea, string]> = [
  ["cost", "Cost"],
  ["speed", "Speed"],
  ["tests", "Tests"],
  ["bugs", "Bugs"],
  ["security", "Security"],
  ["keys", "Keys"],
];
/** Findings filed under an area their aspect would not give them. */
const CODE_AREA: Record<string, CardArea> = {
  deploy_rate: "cost",
  deploy_rate_unread: "cost",
  browser_suite_failed: "tests",
  github_unread: "tests",
  key_rejected: "keys",
  key_unchecked: "keys",
  token_expiring: "keys",
};
const ASPECT_AREA: Record<HealthAspect, CardArea> = {
  cost: "cost",
  performance: "speed",
  security: "security",
  reliability: "bugs",
  quality: "bugs",
  integrity: "bugs",
};

export interface CardInput {
  spentUsd: number;
  ceilingUsd: number;
  neon?: NeonReading;
  deployments?: DeploymentReading;
  field?: readonly VitalSummary[];
  perf?: unknown;
  github?: GitHubReading;
  keys?: readonly Check[];
}

const unread = <T>(value: Read<T> | undefined): value is { error: string } | undefined =>
  value === undefined || (typeof value === "object" && value !== null && "error" in value);
const minutes = (ms: number | null): string =>
  ms === null ? "no runs" : `median ${(ms / 60_000).toFixed(1)} min`;

/** One line per area, its tone the worst finding filed under it: amber on a warning, red on a fault. */
export function buildCard(
  findings: ReadonlyArray<{ code: string; aspect: HealthAspect; severity: "fault" | "warning" }>,
  input: CardInput,
): CardRow[] {
  const { neon, deployments, github, keys } = input;
  const flaky = github?.flaky;
  const issues = github?.old_issues;
  const alerts = github?.dependabot;
  const field = (input.field ?? []).filter((each) => each.device === "mobile" && each.samples > 0);
  const pages = ((input.perf as { pages?: PerfPage[] } | null)?.pages ?? []).filter((page) =>
    [page?.lcp_ms, page?.tbt_ms].every((value) => Number.isFinite(value)),
  );
  const suite = (file: "browser.yml" | "ci.yml"): string => {
    const week = github?.suites[file];
    return unread(week)
      ? `${file} unread`
      : `${file} ${week.passed} passed, ${week.failed} failed, ${minutes(week.median_ms)}`;
  };
  const tokenDays = keys?.find((check) => check.id === "online.github")?.expiresInDays;
  const numbers: Record<CardArea, string[]> = {
    cost: [
      `$${input.spentUsd.toFixed(2)} of $${input.ceilingUsd} in 24 h`,
      unread(neon)
        ? "Neon unread"
        : `Neon pace ${Math.round(neon.pace)} of ${NEON_CU_HOURS_CAP} CU-h (${neon.used.toFixed(1)} used)`,
      unread(deployments) ? "deploys unread" : `${deployments.count} deploys in 24 h of 100`,
    ],
    speed: [
      field.length === 0
        ? "field unread"
        : `phones p75 ${field
            .map(
              (each) =>
                `${each.metric.toUpperCase()} ${each.metric === "cls" ? each.p75.toFixed(2) : `${Math.round(each.p75)} ms`}`,
            )
            .join(", ")}`,
      pages.length === 0
        ? "no lab run"
        : `lab worst LCP ${Math.round(Math.max(...pages.map((page) => page.lcp_ms)))} ms, TBT ${Math.round(Math.max(...pages.map((page) => page.tbt_ms)))} ms`,
    ],
    tests: [
      suite("browser.yml"),
      suite("ci.yml"),
      unread(flaky) ? "flaky unread" : flaky === null ? "no flaky report yet" : `${flaky} flaky`,
    ],
    bugs: [unread(issues) ? "issues unread" : `${issues} issues open over 7 days`],
    security: [unread(alerts) ? "Dependabot alerts unread" : `${alerts} open Dependabot alerts`],
    keys: [
      keys === undefined
        ? "keys not checked"
        : `${keys.filter((check) => check.status === "ok").length} of ${keys.length} keys answer`,
      ...(tokenDays === undefined ? [] : [`GitHub token ends in ${tokenDays} days`]),
    ],
  };
  return AREAS.map(([area, label]) => {
    const filed = findings.filter(
      (each) => (CODE_AREA[each.code] ?? ASPECT_AREA[each.aspect]) === area,
    );
    const tone: CardTone = filed.some((each) => each.severity === "fault")
      ? "red"
      : filed.length > 0
        ? "amber"
        : "green";
    return { area, label, tone, numbers: numbers[area].join("; ") };
  });
}
