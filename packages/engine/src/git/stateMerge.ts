import { CostFile, mergeRecords, UsageFile } from "@singularity/core";
import { parseRunMetrics, RUN_METRICS_KEEP, RUN_METRICS_PATH } from "../metrics/runMetrics.js";

/**
 * How a state file that two workflows both append to is reconciled after a rebase conflict. The
 * 2026-10-27 Catch up failed at its push this way: a digest run and an episode run each added
 * records to `state/costs-2026-10.json` within a second, git saw two edits to the same lines, and the
 * episode, already written, was lost with "rebase_conflict". These files hold counters and lists
 * whose entries do not depend on each other, so the answer is a union, never a choice.
 *
 * A merger gets the three versions of the file (null when one side lacks it) and returns the merged
 * text, or null when it cannot trust what it read: the conflict then stands and the push reports it.
 */
export interface StateVersions {
  /** The common ancestor; null when both sides added the file. */
  base: string | null;
  /** The remote's copy (what the rebase is applied onto). */
  upstream: string;
  /** This run's copy (the commit being replayed). */
  mine: string;
}

export type StateMerge = (versions: StateVersions) => string | null;

const COSTS_PATH = /^state\/costs-\d{4}-\d{2}\.json$/;
const TIMINGS_PATH = "state/podcast-timings.json";
const USAGE_PATH = "state/usage.json";

/** The same cap `recordTimings` keeps; older runs say little about today's speed. */
const TIMINGS_KEEP = 50;

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Parse a state version, returning undefined for an absent ancestor or malformed JSON. */
function parse(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Cost records merge by id, as `recordPaidCalls` merges them: recording twice keeps one. */
const mergeCosts: StateMerge = ({ upstream, mine }) => {
  const theirs = CostFile.safeParse(parse(upstream));
  const ours = CostFile.safeParse(parse(mine));
  if (!theirs.success || !ours.success) return null;
  return serialize({ version: 1, records: mergeRecords(theirs.data.records, ours.data.records) });
};

interface TimedRun {
  at: string;
  run_id: string | null;
}

/** Read a version-1 timings list, requiring an `at` string on every entry; otherwise return null. */
function runsOf(value: unknown): TimedRun[] | null {
  if (typeof value !== "object" || value === null) return null;
  const file = value as { version?: unknown; runs?: unknown };
  if (file.version !== 1 || !Array.isArray(file.runs)) return null;
  const runs = file.runs as unknown[];
  return runs.every((run) => typeof (run as TimedRun | null)?.at === "string")
    ? (runs as TimedRun[])
    : null;
}

/** Stage timings: both runs' entries, one per run, oldest first, the newest 50. */
const mergeTimings: StateMerge = ({ upstream, mine }) => {
  const theirs = runsOf(parse(upstream));
  const ours = runsOf(parse(mine));
  if (theirs === null || ours === null) return null;
  const byKey = new Map<string, TimedRun>();
  for (const run of [...theirs, ...ours]) byKey.set(run.run_id ?? run.at, run);
  const runs = [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-TIMINGS_KEEP);
  return serialize({ version: 1, runs });
};

/**
 * The Speechify counter adds what each run billed: its total is the remote's plus this run's
 * difference from the ancestor. A month that rolled over on one side takes the newer month's count.
 */
const mergeUsage: StateMerge = ({ base, upstream, mine }) => {
  const theirs = UsageFile.safeParse(parse(upstream));
  const ours = UsageFile.safeParse(parse(mine));
  if (!theirs.success || !ours.success) return null;
  const was = UsageFile.safeParse(parse(base));
  const month = theirs.data.speechify.month;
  if (ours.data.speechify.month !== month) {
    return serialize(ours.data.speechify.month > month ? ours.data : theirs.data);
  }
  // Without an ancestor in the same month, both counts started from zero.
  const before = was.success && was.data.speechify.month === month ? was.data.speechify : undefined;
  const added = ours.data.speechify.characters - (before?.characters ?? 0);
  return serialize({
    ...theirs.data,
    speechify: {
      ...theirs.data.speechify,
      characters: theirs.data.speechify.characters + Math.max(0, added),
    },
  });
};

/** Run metrics: one entry per run and digest, oldest first, the newest 60. */
const mergeRunMetrics: StateMerge = ({ upstream, mine }) => {
  const theirs = parseRunMetrics(parse(upstream));
  const ours = parseRunMetrics(parse(mine));
  if (theirs === null || ours === null) return null;
  const byKey = new Map<string, (typeof ours.runs)[number]>();
  for (const run of [...theirs.runs, ...ours.runs]) {
    byKey.set(`${run.run_id}|${run.digest_id}`, run);
  }
  const runs = [...byKey.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-RUN_METRICS_KEEP);
  return serialize({ version: 1, runs });
};

/** The merger for a state file, if its entries are independent enough to union. */
export function stateMergerFor(path: string): StateMerge | undefined {
  if (COSTS_PATH.test(path)) return mergeCosts;
  if (path === TIMINGS_PATH) return mergeTimings;
  if (path === USAGE_PATH) return mergeUsage;
  if (path === RUN_METRICS_PATH) return mergeRunMetrics;
  return undefined;
}
