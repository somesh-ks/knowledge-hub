/**
 * How far along a run is, as the whole number inside the queue's ring. It has to be honest and
 * stable: a share of the time the run is expected to take, not a count of stages (the voices take
 * far longer than the cover), never 0 once running and never 100 until it is done, and a poll that
 * brings nothing new moves it by nothing. Pure, so the queue's script only draws it.
 *
 * Each stage has a usual length: the engine's own timing for it (`stage_estimates_ms`) where it has
 * timed such runs, else the prior below, measured from real runs (a Catch up's workflow takes about
 * two minutes, a Regenerate's about three). The percent is the finished stages' share of the total,
 * plus the current stage's share by the time spent in it, held below nine tenths of it so a stage
 * that overruns waits for its end instead of reaching the next one's share early.
 */

/** Usual milliseconds per stage, by how many stages the run reports (lib/runStages.ts). */
const PRIORS: Record<number, readonly number[]> = {
  // A Catch up (podcast.yml with named steps): gathering, script, cover, publishing, voices, then
  // the wait for the redeploy (about 35 s).
  6: [15_000, 55_000, 10_000, 15_000, 30_000, 40_000],
  // An older episode workflow with one step: getting ready, making it, the redeploy.
  3: [10_000, 110_000, 40_000],
  // A Regenerate (run.yml): schedule, gather, choose, write, check, publish; it goes live with the
  // commit, so "Updating the site" has no length of its own.
  7: [3_000, 54_000, 6_000, 54_000, 46_000, 3_000, 0],
};

/** The share of a stage, by the time spent in it, that is shown before the stage ends. */
const WITHIN_CAP = 0.9;
const FLOOR = 1;
const CEILING = 99;

const usual = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** The length of each stage: the timed one, else the prior, else an even share for a shape nobody has measured. */
function lengths(stages: number, estimates?: readonly unknown[]): number[] {
  const prior = PRIORS[stages];
  return Array.from({ length: stages }, (_, index) => {
    const timed = usual(estimates?.[index]);
    if (timed !== null) return timed;
    return prior ? (prior[index] ?? 0) : 1;
  });
}

export interface PercentInput {
  /** Zero-based stage the run is in, and how many it has. */
  stage: number;
  stages: number;
  /** Milliseconds since it entered that stage. */
  elapsedInStageMs: number;
  /** The status route's usual length of each stage, when the engine has timed such runs. */
  estimates?: readonly unknown[];
  /** A run waiting for a slot has made no progress. */
  queued?: boolean;
}

/** 0 for a run that has not started, else 1 to 99. */
export function queuePercent(input: PercentInput): number {
  if (input.queued || input.stages < 1) return 0;
  const stage = Math.min(Math.max(0, Math.floor(input.stage)), input.stages - 1);
  const parts = lengths(input.stages, input.estimates);
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (total <= 0) return FLOOR;
  const before = parts.slice(0, stage).reduce((sum, part) => sum + part, 0);
  const current = parts[stage] ?? 0;
  const within =
    current > 0 ? Math.min(WITHIN_CAP, Math.max(0, input.elapsedInStageMs) / current) : 0;
  const share = (before + current * within) / total;
  return Math.min(CEILING, Math.max(FLOOR, Math.round(share * 100)));
}
