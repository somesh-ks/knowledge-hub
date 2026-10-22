import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compareNewestFirst,
  type Digest,
  parseDigestFile,
  stockholmDate,
  VOICE_LIMITS,
} from "@dispatch/core";
import { z } from "zod";
import type { EpisodeVoiceEnv } from "../audio/segmentStore.js";
import { loadAllCosts } from "../cost/ledger.js";
import { listDigestTargets } from "../publish/publishAudio.js";
import { DEPLOY_AUDIO_WINDOW_DAYS, digestsLackingAudio } from "../run/pendingAudio.js";
import { loadScheduleFile } from "../schedule/store.js";
import {
  readJudgments,
  readLastRun,
  readSeen,
  readSourceHealth,
  readSourceStats,
  readTopicJudgments,
  readUsage,
} from "../state/store.js";
import {
  checkConfig,
  checkConfigStore,
  checkEpisodes,
  checkPerf,
  checkRunsDied,
  checkStore,
  type FieldReading,
  type HealthAspect,
  type HealthFetch,
  type Sink,
  type StoreReading,
  type WatchedHead,
  type WorkflowRun,
} from "./healthChecks.js";
import { collectStatus } from "./statusReport.js";

export type { FieldReading, HealthAspect, HealthFetch, StoreReading, WatchedHead, WorkflowRun };

/**
 * `dispatch health`: the faults that fail silently today, from the repository files and the live
 * site. A fault exits non-zero; a warning is listed and does not. The `code` of each finding is a
 * contract: `health.yml` retries a run on `run_failed` or `run_overdue` and narration on
 * `audio_missing`, once, when the fault first appears; `run_died` only alerts and `run_cancelled` is a warning.
 */

export interface HealthFinding {
  code: string;
  aspect: HealthAspect;
  severity: "fault" | "warning";
  message: string;
}

export interface HealthReport {
  version: 1;
  now: string;
  ok: boolean;
  findings: HealthFinding[];
  /** What was checked and found fine, one line each. */
  passed: string[];
}

export interface HealthOptions {
  root: string;
  now: Date;
  monthlyChars: number;
  /** Spend over this, in USD across the last 24 hours of the cost ledger, is a fault. */
  ceilingUsd: number;
  /** The live site's origin; null skips every network check. */
  site: string | null;
  fetch?: HealthFetch;
  /** run.yml's recent runs from GitHub (health.yml passes them); absent skips `run_died`. */
  runs?: readonly WorkflowRun[];
  /** The lab probe's output (health.yml passes it; null when it wrote none); absent skips the perf check. */
  perf?: unknown;
  /**
   * The Neon store (the command reads it when online): field Web Vitals (D156), the site's shared
   * rate counter and, with the config store on, its documents. Absent skips them.
   */
  store?: StoreReading;
  /** The newest commit the site would deploy (the command reads git when online); absent skips `site_behind`. */
  main?: WatchedHead;
  /** The voices episodes are narrated in, so their stored segments are found by address. */
  voices?: EpisodeVoiceEnv;
}

/** A briefing with fewer stories than this is thin (the schema stops at 3): the run found little or dropped most. */
export const THIN_DIGEST_ITEMS = 5;
/**
 * Shares of its set length below which an episode is short: a warning under 90%, a fault (the
 * `health` issue) under 75%. Every daily from 2026-10-11 to 10-17 aired 2.9 to 3.8 of its 5
 * minutes and the 10-18 weekly 5 of its 15, and nothing said so for a week.
 */
export const SHORT_EPISODE_WARN = 0.9;
export const SHORT_EPISODE_FAULT = 0.75;
/** A story summary this short is a stub: a third of what the writer's lint asks for. */
export const SHORT_STORY_WORDS = Math.floor(VOICE_LIMITS.summaryMinWords / 3);
/** A deploy that has not picked up a new digest after this long has failed (Hobby author check). */
export const DEPLOY_LAG_MS = 45 * 60_000;
/**
 * A deploy missing this long will not clear by itself: a fault (D159). #220's vercel.json failed
 * Vercel's schema and every deploy for hours, and a warning reaches the owner only on Mondays (the
 * `health-warnings` issue). Counted from the oldest commit the site lacks, since a digest lands every
 * second day and would restart a clock counted from the newest.
 */
export const DEPLOY_MISSING_FAULT_MS = 24 * 60 * 60_000;
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 20_000;

/** Headers vercel.json sets on every page; a deploy that drops one has lost the file. */
const PAGE_HEADERS: Record<string, string> = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=",
};

export async function collectHealth(options: HealthOptions): Promise<HealthReport> {
  const { root, now } = options;
  const findings: HealthFinding[] = [];
  const passed: string[] = [];
  const fault = (code: string, aspect: HealthAspect, message: string): void => {
    findings.push({ code, aspect, severity: "fault", message });
  };
  const warn = (code: string, aspect: HealthAspect, message: string): void => {
    findings.push({ code, aspect, severity: "warning", message });
  };

  const status = await collectStatus(root, now, options.monthlyChars);
  for (const warning of status.warnings) fault("state_invalid", "integrity", warning);

  // Reliability: the scheduled runs.
  for (const [label, run] of [
    ["regular", status.last_run.regular],
    ["weekly", status.last_run.weekly],
  ] as const) {
    if (run?.outcome === "failed") {
      fault("run_failed", "reliability", `The last ${label} run failed (${run.at}).`);
    }
  }
  if (status.next_regular_due < status.today) {
    fault(
      "run_overdue",
      "reliability",
      `The regular briefing was due ${status.next_regular_due} and no run has published since: the scheduled trigger missed it.`,
    );
  } else {
    passed.push(`next regular briefing due ${status.next_regular_due}`);
  }

  if (options.runs) {
    const records = [status.last_run.regular, status.last_run.weekly, status.last_run.on_demand];
    checkRunsDied(records, options.runs, now, { fault, warn, passed });
  }

  // Integrity: every digest parses, and every state file reads against its schema.
  const digests: Array<{ digest: Digest; path: string }> = [];
  for (const target of await listDigestTargets(root)) {
    try {
      digests.push({
        digest: parseDigestFile(await readFile(join(root, target.relPath), "utf8")),
        path: target.relPath,
      });
    } catch (error) {
      fault("digest_invalid", "integrity", `${target.relPath} does not parse: ${message(error)}`);
    }
  }
  const readers: Array<[string, () => Promise<unknown>]> = [
    ["state/seen.json", () => readSeen(root)],
    ["state/judgments.json", () => readJudgments(root)],
    ["state/topic-judgments.json", () => readTopicJudgments(root)],
    ["state/source-health.json", () => readSourceHealth(root)],
    ["state/source-stats.json", () => readSourceStats(root)],
    ["state/usage.json", () => readUsage(root, now)],
  ];
  for (const [label, read] of readers) {
    try {
      await read();
    } catch (error) {
      fault("state_invalid", "integrity", `${label}: ${message(error)}`);
    }
  }
  if (!findings.some((each) => each.aspect === "integrity")) {
    passed.push(`${digests.length} digests and the state files parse`);
  }

  // Quality: the newest briefing has enough stories, was checked against its sources, and the run
  // did not lean on fallback models.
  // The site's order: a regenerated briefing keeps its date, so ordering by generated_at alone
  // took an older one for the newest and faulted site_stale.
  const latest = [...digests].sort((a, b) => compareNewestFirst(a.digest, b.digest))[0];
  if (latest) {
    const { digest } = latest;
    if (digest.items.length < THIN_DIGEST_ITEMS) {
      warn(
        "digest_thin",
        "quality",
        `${digest.id} has ${digest.items.length} stories (under ${THIN_DIGEST_ITEMS}).`,
      );
    }
    if (!digest.verified) warn("digest_unverified", "quality", `${digest.id} is not verified.`);
    // The narration against the length config/schedule.json sets for its kind. A missing schedule
    // sets none, and an on-demand episode is sized by its request.
    const schedule = await loadScheduleFile(root).catch(() => null);
    const minutes =
      schedule === null
        ? null
        : digest.kind === "weekly"
          ? schedule.weekly.length_minutes
          : digest.kind === "regular"
            ? schedule.length_minutes
            : null;
    if (digest.audio && minutes !== null) {
      const share = digest.audio.duration_ms / (minutes * 60_000);
      const line = `${digest.id} aired ${(digest.audio.duration_ms / 60_000).toFixed(1)} of its ${minutes} minutes (${Math.round(share * 100)}%).`;
      if (share < SHORT_EPISODE_FAULT) fault("episode_short", "quality", line);
      else if (share < SHORT_EPISODE_WARN) warn("episode_short", "quality", line);
    }
    // A summary the writer left as a stub parses and airs as a gap in the narration.
    const stubs = digest.items.filter(
      (item) => item.summary.trim().split(/\s+/).length < SHORT_STORY_WORDS,
    );
    if (stubs.length > 0) {
      warn(
        "story_short",
        "quality",
        `${digest.id} has ${stubs.length} stories under ${SHORT_STORY_WORDS} words: ${stubs.map((item) => item.headline).join("; ")}.`,
      );
    }
  }
  const lastRun = await readLastRun(root).catch(() => null);
  const fallbacks = lastRun?.spend?.requests.model_fallback ?? 0;
  if (fallbacks > 0) {
    warn(
      "model_fallback",
      "quality",
      `The last run moved to a fallback model ${fallbacks} times (config/models.json).`,
    );
  }
  for (const source of status.sources.failing) {
    warn("source_failing", "quality", `${source.id} failed ${source.failures} runs in a row.`);
  }

  // Narration: recent briefings with no audio after their audio run. Today's may still be narrating.
  const missing = (await digestsLackingAudio(root, now, DEPLOY_AUDIO_WINDOW_DAYS)).filter(
    (id) => id.slice(0, 10) < status.today,
  );
  if (missing.length > 0) {
    fault("audio_missing", "reliability", `No narration for ${missing.join(", ")}.`);
  }

  // The public Blob store's address is in every narration URL; it is not a secret (config.ts).
  const withAudio = [...digests]
    .filter((each) => each.digest.audio?.url.startsWith("https://"))
    .sort((a, b) => compareNewestFirst(a.digest, b.digest))[0];
  const blobBase = withAudio?.digest.audio ? new URL(withAudio.digest.audio.url).origin : null;
  const get = options.fetch ?? fetch;
  const blob = options.site !== null && blobBase !== null ? { base: blobBase, get } : null;

  // Cost: the ledger's last 24 hours against the ceiling, and the speech allowance. Online, the
  // site's own month count (apps/web narrationState.ts) is added to the allowance:
  // state/usage.json holds only the engine's.
  const site = blob ? await readSiteNarration(blob, now) : null;
  if (site && "error" in site) {
    warn("site_usage_unread", "cost", `The site's narration count did not read: ${site.error}.`);
  }
  const siteCount = site && !("error" in site) ? site : { month: 0 };
  const since = now.getTime() - DAY_MS;
  const records = await loadAllCosts(root).catch((error: unknown) => {
    fault("state_invalid", "integrity", `state/costs-*.json: ${message(error)}`);
    return [];
  });
  const spent = records
    .filter((record) => Date.parse(record.at) > since)
    .reduce((sum, record) => sum + record.usd, 0);
  if (spent > options.ceilingUsd) {
    fault(
      "cost_over_ceiling",
      "cost",
      `$${spent.toFixed(2)} spent in the last 24 hours, over the $${options.ceilingUsd} ceiling.`,
    );
  } else {
    passed.push(`$${spent.toFixed(2)} spent in the last 24 hours`);
  }
  const speech = status.budget.speechify;
  const used = speech.used + siteCount.month;
  const percent = Math.round((used / speech.monthly_chars) * 100);
  if (used >= speech.limit) {
    fault(
      "speech_budget",
      "cost",
      `Speechify use this month is past the 90% stop (${speech.used} by the engine, ${siteCount.month} by the site, ${used} of ${speech.monthly_chars}). Each stop checks only its own counter, so neither sees the other and narration can go on past the plan's cap.`,
    );
  } else if (percent >= 75) {
    warn(
      "speech_budget",
      "cost",
      `Speechify at ${percent}% this month (${siteCount.month} characters on the site).`,
    );
  }

  // Integrity: the config files parse with the core schemas (doctor's checks, daily).
  await checkConfig(root, { fault, warn, passed });

  // Quality: every episode parses and narrates whole; the newest one's word marks read.
  await checkEpisodes(root, options.voices ?? {}, now, { fault, warn, passed }, blob);

  if (options.perf !== undefined) checkPerf(options.perf, { fault, warn, passed });
  if (options.store !== undefined) {
    checkStore(options.store, { fault, warn, passed });
    const documents = "documents" in options.store ? options.store.documents : undefined;
    if (documents && "error" in documents) {
      fault(
        "config_store_unread",
        "integrity",
        `The config store is on but its documents did not read (not seeded, or no permission?): ${documents.error}. Runs then keep the committed files, so the owner's edits do not reach them.`,
      );
    } else if (documents) {
      const lastRunAt =
        [status.last_run.regular, status.last_run.weekly, status.last_run.on_demand]
          // A failure record (recordFailure) committed nothing the store could have reached.
          .map((each) => (each?.outcome === "failed" ? undefined : each?.at))
          .filter((at): at is string => typeof at === "string")
          .sort()
          .at(-1) ?? null;
      await checkConfigStore(root, documents, lastRunAt, { fault, warn, passed });
    }
  }

  if (options.site !== null) {
    await checkSite(options.site, get, latest?.digest ?? null, options.main, now, {
      fault,
      warn,
      passed,
    });
  }

  return {
    version: 1,
    now: now.toISOString(),
    ok: !findings.some((each) => each.severity === "fault"),
    findings,
    passed,
  };
}

async function checkSite(
  site: string,
  get: HealthFetch,
  latest: Digest | null,
  main: WatchedHead | undefined,
  now: Date,
  sink: Sink,
): Promise<void> {
  const ask = async (path: string, method = "GET") => {
    try {
      return await get(`${site}${path}`, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      sink.fault("site_down", "reliability", `${path} did not answer: ${message(error)}`);
      return null;
    }
  };

  const home = await ask("/");
  if (home && home.status !== 200) {
    sink.fault("site_down", "reliability", `/ answered ${home.status}.`);
  } else if (home) {
    const missing = Object.entries(PAGE_HEADERS)
      .filter(([name, part]) => !(home.headers.get(name) ?? "").includes(part))
      .map(([name]) => name);
    if (missing.length > 0) {
      sink.fault("site_headers", "security", `/ is missing ${missing.join(", ")}.`);
    } else {
      sink.passed.push("/ answers 200 with its security headers");
    }
  }

  // The server loads: a GET of a POST-only route is refused by the function, not the edge.
  const api = await ask("/api/podcast");
  if (api && api.status !== 405) {
    sink.fault("site_api", "reliability", `/api/podcast answered ${api.status}, wanted 405.`);
  }

  // A deploy reaches an open or installed app only if the browser asks for the worker each time
  // (no-cache) and /build.json names the build (sw.js, scripts/serviceWorker.ts; 2026-10-21).
  const worker = await ask("/sw.js");
  const build = await ask("/build.json");
  let buildName: unknown;
  try {
    buildName =
      build?.status === 200
        ? (JSON.parse(await build.text()) as { build?: unknown }).build
        : undefined;
  } catch {
    buildName = undefined;
  }
  // The build carries the newest commit the site would deploy: a push whose last commit touches no
  // watched path skips the deploy (vercel.json diffs HEAD^ only), and this says so.
  // A build named by its start time (no commit: the dev server, a build off Vercel) says nothing.
  // Such a name is all digits, so a commit prefix must hold a letter; an all-digit commit prefix
  // (rare) is skipped too. A warning at first, since the next push may clear it; a fault once the
  // oldest commit it lacks is a day old (DEPLOY_MISSING_FAULT_MS).
  if (
    main &&
    typeof buildName === "string" &&
    /^(?=.*[a-f])[0-9a-f]{7,40}$/.test(buildName) &&
    now.getTime() - main.at > DEPLOY_LAG_MS
  ) {
    const holds = await main.includes(buildName);
    if (holds === true) {
      sink.passed.push(`the site's build holds ${main.sha.slice(0, 12)}`);
    } else if (holds === false) {
      const lag = now.getTime() - ((await main.missingSince(buildName)) ?? main.at);
      const ago =
        lag >= 2 * 3_600_000
          ? `${Math.round(lag / 3_600_000)} hours`
          : `${Math.round(lag / 60_000)} minutes`;
      const text = `The site's build ${buildName} does not hold ${main.sha.slice(0, 12)}, nor commits from ${ago} ago on: those deploys did not happen.`;
      if (lag > DEPLOY_MISSING_FAULT_MS) {
        sink.fault(
          "site_behind",
          "reliability",
          `${text} Redeploy from Vercel; its log says whether the build failed or was skipped.`,
        );
      } else {
        sink.warn("site_behind", "reliability", text);
      }
    }
  }
  if (worker && build) {
    const cached = !/no-cache|no-store|max-age=0\b/.test(worker.headers.get("cache-control") ?? "");
    if (worker.status !== 200 || cached || typeof buildName !== "string") {
      sink.fault(
        "site_update",
        "reliability",
        `An installed app cannot see a deploy: /sw.js answered ${worker.status} (cache-control ${worker.headers.get("cache-control") ?? "none"}), /build.json answered ${build.status}.`,
      );
    } else {
      sink.passed.push(`the site names its build (${buildName})`);
    }
  }

  // The deploy carries the newest committed briefing: Vercel skips a commit it will not build
  // (a wrong author on Hobby, a failed build) without telling anyone.
  const answer = await ask("/latest.json");
  if (answer?.status === 200 && latest) {
    let served: { id?: string | null } = {};
    try {
      served = JSON.parse(await answer.text()) as { id?: string | null };
    } catch {
      sink.fault("site_api", "reliability", "/latest.json is not JSON.");
      return;
    }
    const age = now.getTime() - Date.parse(latest.generated_at);
    if (served.id !== latest.id && age > DEPLOY_LAG_MS) {
      sink.fault(
        "site_stale",
        "reliability",
        `The site serves ${served.id ?? "nothing"}, but ${latest.id} was committed ${Math.round(age / 60_000)} minutes ago: the deploy did not happen.`,
      );
    } else {
      sink.passed.push(`the site serves ${served.id ?? "no briefing"}`);
    }
  } else if (answer) {
    sink.fault("site_api", "reliability", `/latest.json answered ${answer.status}.`);
  }

  // Narration of the newest briefing is reachable on the Blob host.
  if (latest?.audio) {
    try {
      const head = await get(latest.audio.url, {
        method: "HEAD",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (head.status >= 400) {
        sink.fault(
          "audio_unreachable",
          "reliability",
          `${latest.id}'s narration answered ${head.status}.`,
        );
      } else {
        sink.passed.push(`${latest.id}'s narration is reachable`);
      }
    } catch (error) {
      sink.fault("audio_unreachable", "reliability", `${latest.id}'s narration: ${message(error)}`);
    }
  }
}

/**
 * The site's Speechify characters this Stockholm month (apps/web narrationState.ts, at
 * `state/usage-<month>.json` on the public Blob store). Monthly only: its records are per day, so
 * they give no 24-hour figure for the ceiling. Nothing stored is a month with none; a document
 * whose month is not its key is unreadable, as the site's own parseState reads it.
 */
async function readSiteNarration(
  blob: { base: string; get: HealthFetch },
  now: Date,
): Promise<{ month: number } | { error: string }> {
  const month = stockholmDate(now).slice(0, 7);
  try {
    // The unique query skips the CDN's copy, as the site's readFresh does.
    const answer = await blob.get(`${blob.base}/state/usage-${month}.json?v=${now.getTime()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (answer.status === 404) return { month: 0 };
    if (answer.status !== 200) return { error: `usage-${month}.json answered ${answer.status}` };
    const state = SiteNarration.parse(JSON.parse(await answer.text()));
    if (state.speechify.month !== month) {
      return { error: `usage-${month}.json holds the count for ${state.speechify.month}` };
    }
    return { month: state.speechify.characters };
  } catch (error) {
    return { error: message(error) };
  }
}

/** What health reads of the site's count; the site's own schema (narrationState.ts) holds more. */
const SiteNarration = z.object({
  speechify: z.object({ month: z.string(), characters: z.number().nonnegative() }),
});

function message(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
}

/** The text form: faults first, then warnings, then what passed. */
export function formatHealth(report: HealthReport): string {
  const lines = [`Dispatch health, ${report.now}: ${report.ok ? "ok" : "FAULTS"}`];
  for (const severity of ["fault", "warning"] as const) {
    for (const each of report.findings.filter((finding) => finding.severity === severity)) {
      lines.push(
        `${severity === "fault" ? "FAULT" : "warn "} [${each.aspect}] ${each.code}: ${each.message}`,
      );
    }
  }
  for (const line of report.passed) lines.push(`ok    ${line}`);
  return lines.join("\n");
}
