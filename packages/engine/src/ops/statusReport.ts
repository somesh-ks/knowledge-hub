import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compareNewestFirst,
  DEFAULT_SCHEDULE,
  type Digest,
  type LastRunFile,
  parseDigestFile,
  type RunRecord,
  scheduleZone,
  stockholmDate,
  zonedDate,
} from "@singularity/core";
import { BUDGET_RATIO, loadUsage } from "../audio/budget.js";
import { decideRun } from "../gate/decideRun.js";
import { listDigestTargets } from "../publish/publishAudio.js";
import { AUDIO_RETENTION_DAYS, digestsLackingAudio } from "../run/pendingAudio.js";
import { loadSchedule } from "../schedule/store.js";
import { loadSources } from "../sources/registry.js";
import { FAILURE_FLAG_THRESHOLD, failingSources, overlayHealth } from "../state/sourceHealth.js";
import { readLastRun, readSourceHealth } from "../state/store.js";

export interface RunSummary {
  at: string;
  outcome: RunRecord["outcome"];
  digest_id: string | null;
  items: number;
}

export interface StatusReport {
  /** Bump when a field changes meaning; the sk-dispatch skill and scripts read this shape. */
  version: 1;
  now: string;
  timezone: string;
  /** Stockholm calendar date of `now`. */
  today: string;
  last_run: {
    regular: RunSummary | null;
    weekly: RunSummary | null;
    on_demand: RunSummary | null;
  };
  last_fetch_at: string | null;
  /** Stockholm date the next regular digest becomes due: two days after the last regular run. */
  next_regular_due: string;
  /** True when a scheduled run would produce a regular digest today. */
  due_now: boolean;
  due_reason: string;
  latest_digest: {
    id: string;
    kind: Digest["kind"];
    date: string;
    items: number;
    verified: boolean;
    has_audio: boolean;
    path: string;
  } | null;
  audio: {
    /** True when a digest inside the retention window still has `audio: null`. */
    pending: boolean;
    /** Digest ids lacking audio, newest first. */
    missing: string[];
    retention_days: number;
  };
  sources: {
    total: number;
    enabled: number;
    failure_threshold: number;
    failing: Array<{ id: string; name: string; failures: number; last_ok: string | null }>;
  };
  budget: {
    speechify: {
      month: string;
      used: number;
      /** 90 percent of the monthly allowance: synthesis stops here. */
      limit: number;
      monthly_chars: number;
      percent: number;
    };
  };
  /** Files that could not be read; the rest of the report still holds. */
  warnings: string[];
}

function summarize(record: RunRecord | undefined): RunSummary | null {
  if (!record) return null;
  return {
    at: record.at,
    outcome: record.outcome,
    digest_id: record.digest_id ?? null,
    items: record.items,
  };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Date, in `zone`, of the last regular run that counts toward the cadence, as the gate sees it. */
function lastRegularDate(lastRun: LastRunFile, zone: string): string | undefined {
  const record = lastRun.regular;
  if (!record || (record.outcome !== "published" && record.outcome !== "nothing")) return undefined;
  return zonedDate(new Date(record.at), zone);
}

const LATEST_CANDIDATES = 5;

async function latestDigest(root: string): Promise<StatusReport["latest_digest"]> {
  let best: { digest: Digest; path: string } | null = null;
  for (const target of (await listDigestTargets(root)).slice(0, LATEST_CANDIDATES)) {
    try {
      const digest = parseDigestFile(await readFile(join(root, target.relPath), "utf8"));
      // The site's order: by generated_at alone a regenerated older briefing read as the latest.
      if (best === null || compareNewestFirst(digest, best.digest) < 0) {
        best = { digest, path: target.relPath };
      }
    } catch {
      // An unreadable digest is `singularity validate`'s to report.
    }
  }
  if (best === null) return null;
  return {
    id: best.digest.id,
    kind: best.digest.kind,
    date: best.digest.date,
    items: best.digest.items.length,
    verified: best.digest.verified,
    has_audio: best.digest.audio !== null,
    path: best.path,
  };
}

/** Everything `singularity status` prints, from the repository files alone. */
export async function collectStatus(
  root: string,
  now: Date,
  monthlyChars: number,
): Promise<StatusReport> {
  const warnings: string[] = [];
  const guard = async <T>(label: string, fallback: T, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : "unreadable"}`);
      return fallback;
    }
  };

  const lastRun = await guard<LastRunFile>("state/last-run.json", { version: 1 }, () =>
    readLastRun(root),
  );
  const schedule = await guard("config/schedule.json", DEFAULT_SCHEDULE, () => loadSchedule(root));
  // The schedule's dates are on its own clock; the speech budget's month stays on Stockholm's.
  const zone = scheduleZone(schedule.timezone);
  const today = zonedDate(now, zone);
  const decision = decideRun({
    now,
    mode: "scheduled",
    lastRun,
    force: false,
    cadenceDays: schedule.cadence_days,
    weekly: schedule.weekly,
    zone,
    dailyEnabled: schedule.enabled,
  });
  const last = lastRegularDate(lastRun, zone);

  const registry = await guard("config/sources.json", null, () => loadSources(root));
  const health = await guard("state/source-health.json", { version: 1 as const, sources: {} }, () =>
    readSourceHealth(root),
  );
  const sources = registry ? overlayHealth(registry, health) : { version: 1 as const, sources: [] };

  const usage = await guard("state/usage.json", null, () => loadUsage(root, now));
  const used = usage?.speechify.characters ?? 0;
  const limit = Math.floor(monthlyChars * BUDGET_RATIO);

  const missing = await guard("Digests/", [] as string[], () =>
    digestsLackingAudio(root, now, AUDIO_RETENTION_DAYS),
  );

  return {
    version: 1,
    now: now.toISOString(),
    timezone: zone,
    today,
    last_run: {
      regular: summarize(lastRun.regular),
      weekly: summarize(lastRun.weekly),
      on_demand: summarize(lastRun.on_demand),
    },
    last_fetch_at: lastRun.last_fetch_at ?? null,
    next_regular_due: last === undefined ? today : addDays(last, schedule.cadence_days),
    due_now: decision.due,
    due_reason: decision.reason,
    latest_digest: await guard("Digests/", null, () => latestDigest(root)),
    audio: { pending: missing.length > 0, missing, retention_days: AUDIO_RETENTION_DAYS },
    sources: {
      total: sources.sources.length,
      enabled: sources.sources.filter((source) => source.enabled).length,
      failure_threshold: FAILURE_FLAG_THRESHOLD,
      failing: failingSources(sources).map((source) => ({
        id: source.id,
        name: source.name,
        failures: source.failures,
        last_ok: source.last_ok ?? null,
      })),
    },
    budget: {
      speechify: {
        month: usage?.speechify.month ?? stockholmDate(now).slice(0, 7),
        used,
        limit,
        monthly_chars: monthlyChars,
        percent: Math.round((used / monthlyChars) * 1000) / 10,
      },
    },
    warnings,
  };
}

function runLine(label: string, run: RunSummary | null): string {
  if (run === null) return `  ${label.padEnd(10)} none yet`;
  const digest = run.digest_id ? `, ${run.digest_id}` : "";
  return `  ${label.padEnd(10)} ${run.outcome}${digest}, ${run.items} items, ${run.at}`;
}

/** The text form of the report. */
export function formatStatus(report: StatusReport): string {
  const lines = [
    `Singularity status, ${report.today} (${report.timezone})`,
    "",
    "Last runs",
    runLine("regular", report.last_run.regular),
    runLine("weekly", report.last_run.weekly),
    runLine("on-demand", report.last_run.on_demand),
    `  last fetch ${report.last_fetch_at ?? "never"}`,
    "",
    `Next regular digest: ${report.due_now ? "due now" : `due ${report.next_regular_due}`} (${report.due_reason})`,
  ];
  const latest = report.latest_digest;
  lines.push(
    latest
      ? `Latest digest: ${latest.id} (${latest.kind}), ${latest.items} items, ${latest.has_audio ? "audio ready" : "no audio yet"}${latest.verified ? "" : ", unverified"}`
      : "Latest digest: none yet",
  );
  lines.push(
    report.audio.pending
      ? `Audio missing for ${report.audio.missing.length}: ${report.audio.missing.slice(0, 5).join(", ")}`
      : "Audio: every digest in the window has narration",
  );
  const { failing } = report.sources;
  lines.push(
    `Sources: ${report.sources.enabled} enabled of ${report.sources.total}, ${failing.length} failing ${report.sources.failure_threshold} runs in a row`,
  );
  for (const source of failing) {
    lines.push(`  ${source.id}: ${source.failures} failures, last ok ${source.last_ok ?? "never"}`);
  }
  const speechify = report.budget.speechify;
  lines.push(
    `Speechify ${speechify.month}: ${speechify.used} of ${speechify.monthly_chars} characters (${speechify.percent}%), stops at ${speechify.limit}`,
  );
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
