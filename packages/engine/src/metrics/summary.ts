import type { EpisodeMetrics, TimingEntry } from "../podcast/timings.js";
import type { RunMetric } from "./runMetrics.js";

/**
 * What the health numbers say, in one place for `singularity metrics` and `singularity health`.
 * Targets are the ones in docs/engineering/metrics.md; change them there and here together.
 */
export const TARGETS = {
  /** Narration aired over the owner's length, a briefing's median. */
  lengthShareMin: 0.9,
  /** Stories kept after grounding over stories written. */
  groundingSurvivalMin: 0.85,
  /** Runs that publish a briefing with every sentence checked. */
  verifiedShareMin: 0.9,
  /** Model fallbacks a run takes on average. */
  fallbacksPerRunMax: 1,
  /** A briefing's generation, plan to commit. */
  briefingMsMax: 4 * 60_000,
  /** Failed runs over runs. */
  failureRateMax: 0.1,
  /** An episode's script over the length asked, a median. */
  episodeShareMin: 0.9,
  /** An episode's three stages, select to publish. */
  episodeMsMax: 3 * 60_000,
} as const;

/** How many of the newest runs a summary reads: older ones say little about today. */
export const WINDOW = 10;
/** Fewer runs than this and no number is judged: a single odd run is not a trend. */
export const MIN_RUNS = 3;

export type Verdict = "ok" | "off" | "unmeasured";

export interface Reading {
  metric: string;
  value: number | null;
  target: string;
  verdict: Verdict;
}

export interface Summary {
  briefings: { runs: number; readings: Reading[]; stage_ms: Record<string, number> };
  episodes: { runs: number; readings: Reading[]; stage_ms: Record<string, number> };
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

const round = (value: number | null, places = 2): number | null =>
  value === null ? null : Math.round(value * 10 ** places) / 10 ** places;

const reading = (
  metric: string,
  value: number | null,
  target: string,
  ok: (value: number) => boolean,
  enough: boolean,
): Reading => ({
  metric,
  value: round(value),
  target,
  verdict: value === null || !enough ? "unmeasured" : ok(value) ? "ok" : "off",
});

function stageMedians(entries: ReadonlyArray<Record<string, number>>): Record<string, number> {
  const names = new Set(entries.flatMap((stages) => Object.keys(stages)));
  const out: Record<string, number> = {};
  for (const name of names) {
    const values = entries.flatMap((stages) => (stages[name] === undefined ? [] : [stages[name]]));
    const value = median(values);
    if (value !== null) out[name] = Math.round(value);
  }
  return out;
}

/** The newest `WINDOW` briefing runs and episodes, judged against the targets. */
export function summarize(input: {
  runs: readonly RunMetric[];
  timings: readonly TimingEntry[];
}): Summary {
  // The window is ten runs, not ten entries: a run that made a regular and a weekly briefing leaves
  // one entry for each under one run_id, and a failed one must count once.
  const newestFirst = [...input.runs].sort((a, b) => b.at.localeCompare(a.at));
  const ids = [...new Set(newestFirst.map((run) => run.run_id))].slice(0, WINDOW);
  const windowed = new Set(ids);
  const runs = newestFirst.filter((run) => windowed.has(run.run_id));
  const failedRuns = new Set(
    runs.filter((run) => run.outcome === "failed").map((run) => run.run_id),
  );
  const finished = runs.filter((run) => run.outcome !== "failed");
  const published = runs.filter((run) => run.outcome === "published");
  const sized = published.flatMap((run) => (run.length.share === null ? [] : [run.length.share]));
  // Grounding checks what the writer wrote and what the refill wrote after it, so both count. A
  // pass that published nothing counts too: grounding dropping its stories is what emptied it.
  const survival = finished.flatMap((run) => {
    const checked = run.funnel.written + run.funnel.refill_written;
    return checked > 0 ? [Math.max(0, 1 - run.funnel.grounding_dropped / checked)] : [];
  });
  const enough = ids.length >= MIN_RUNS;
  // A run's fallbacks, total time and stage clock are copied into each of its passes: one entry a
  // run, or a regular and a weekly briefing would weigh it twice.
  const finishedRuns = [...new Map(finished.map((run) => [run.run_id, run])).values()];
  const timed = finishedRuns.flatMap((run) => (run.total_ms === undefined ? [] : [run.total_ms]));

  const episodes = [...input.timings]
    .filter((entry) => entry.metrics !== undefined)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, WINDOW);
  const metrics = (entry: TimingEntry): EpisodeMetrics => entry.metrics as EpisodeMetrics;
  const episodeMs = episodes.map((entry) =>
    Object.values(entry.stages).reduce((sum, value) => sum + value, 0),
  );
  const episodesEnough = episodes.length >= MIN_RUNS;

  return {
    briefings: {
      runs: ids.length,
      readings: [
        reading(
          "failure_rate",
          ids.length === 0 ? null : failedRuns.size / ids.length,
          `<= ${TARGETS.failureRateMax}`,
          (v) => v <= TARGETS.failureRateMax,
          enough,
        ),
        reading(
          "length_share",
          median(sized),
          `>= ${TARGETS.lengthShareMin}`,
          (v) => v >= TARGETS.lengthShareMin,
          sized.length >= MIN_RUNS,
        ),
        reading(
          "grounding_survival",
          median(survival),
          `>= ${TARGETS.groundingSurvivalMin}`,
          (v) => v >= TARGETS.groundingSurvivalMin,
          survival.length >= MIN_RUNS,
        ),
        reading(
          "verified_share",
          published.length === 0
            ? null
            : published.filter((run) => run.verified).length / published.length,
          `>= ${TARGETS.verifiedShareMin}`,
          (v) => v >= TARGETS.verifiedShareMin,
          published.length >= MIN_RUNS,
        ),
        reading(
          "model_fallbacks_per_run",
          mean(finishedRuns.map((run) => run.model_fallbacks)),
          `<= ${TARGETS.fallbacksPerRunMax}`,
          (v) => v <= TARGETS.fallbacksPerRunMax,
          finishedRuns.length >= MIN_RUNS,
        ),
        reading(
          "generation_ms",
          median(timed),
          `<= ${TARGETS.briefingMsMax}`,
          (v) => v <= TARGETS.briefingMsMax,
          timed.length >= MIN_RUNS,
        ),
      ],
      stage_ms: stageMedians(finishedRuns.map((run) => run.stage_ms)),
    },
    episodes: {
      runs: episodes.length,
      readings: [
        reading(
          "script_share",
          median(episodes.map((entry) => metrics(entry).share)),
          `>= ${TARGETS.episodeShareMin}`,
          (v) => v >= TARGETS.episodeShareMin,
          episodesEnough,
        ),
        reading(
          "generation_ms",
          median(episodeMs),
          `<= ${TARGETS.episodeMsMax}`,
          (v) => v <= TARGETS.episodeMsMax,
          episodesEnough,
        ),
      ],
      stage_ms: stageMedians(episodes.map((entry) => entry.stages)),
    },
  };
}

const MINUTE = 60_000;

/** One reading as a line: "length_share 0.62 (target >= 0.9) off". */
export function formatReading(entry: Reading): string {
  const value =
    entry.value === null
      ? "n/a"
      : entry.metric.endsWith("_ms")
        ? `${(entry.value / MINUTE).toFixed(1)} min`
        : String(entry.value);
  const target = entry.metric.endsWith("_ms")
    ? entry.target.replace(/\d+/, (n) => (Number(n) / MINUTE).toFixed(0)).concat(" min")
    : entry.target;
  return `${entry.metric.padEnd(26)} ${value.padEnd(10)} target ${target.padEnd(12)} ${entry.verdict}`;
}
