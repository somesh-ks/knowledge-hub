import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Digest, parseDigestFile, VOICE_LIMITS } from "@dispatch/core";
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
  checkEpisodes,
  checkPerf,
  checkRunsDied,
  type HealthAspect,
  type HealthFetch,
  type Sink,
  type WorkflowRun,
} from "./healthChecks.js";
import { collectStatus } from "./statusReport.js";

export type { HealthAspect, HealthFetch, WorkflowRun };

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
  const latest = [...digests].sort((a, b) =>
    a.digest.generated_at < b.digest.generated_at ? 1 : -1,
  )[0];
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

  // Cost: the ledger's last 24 hours against the ceiling, and the speech allowance.
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
  if (status.budget.speechify.used >= status.budget.speechify.limit) {
    fault("speech_budget", "cost", "Speechify is at its 90% stop: narration is off this month.");
  } else if (status.budget.speechify.percent >= 75) {
    warn("speech_budget", "cost", `Speechify at ${status.budget.speechify.percent}% this month.`);
  }

  // Integrity: the config files parse with the core schemas (doctor's checks, daily).
  await checkConfig(root, { fault, warn, passed });

  // The public Blob store's address is in every narration URL; it is not a secret (config.ts).
  const withAudio = [...digests]
    .filter((each) => each.digest.audio?.url.startsWith("https://"))
    .sort((a, b) => (a.digest.generated_at < b.digest.generated_at ? 1 : -1))[0];
  const blobBase = withAudio?.digest.audio ? new URL(withAudio.digest.audio.url).origin : null;
  const get = options.fetch ?? fetch;
  const blob = options.site !== null && blobBase !== null ? { base: blobBase, get } : null;

  // Quality: every episode parses and narrates whole; the newest one's word marks read.
  await checkEpisodes(root, options.voices ?? {}, now, { fault, warn, passed }, blob);

  if (options.perf !== undefined) checkPerf(options.perf, { fault, warn, passed });

  if (options.site !== null) {
    await checkSite(options.site, get, latest?.digest ?? null, now, {
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
