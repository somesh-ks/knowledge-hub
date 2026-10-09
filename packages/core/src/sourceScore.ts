import type { SourceStat } from "./state.js";

/**
 * Quality score of an existing source, 0 to 5 with one decimal. Pure: the caller passes the
 * counters from state/source-stats.json, the failure record from state/source-health.json and the
 * discovery quality from config/sources.json.
 *
 * Weighting, in order of importance (the weights add up to 5):
 * - Yield, up to 3.0. The share of judged items that passed (40 percent of the yield) and that
 *   were published (60 percent). A pass rate of 50 percent and a publish rate of 25 percent each
 *   earn the full part; a source that never reaches a digest earns nothing here.
 * - Reliability, up to 1.2. Consecutive failed fetches (60 percent) and how recently a fetch
 *   last worked (40 percent).
 * - Volume, up to 0.5. A source that yields one published item a month is weak even when every
 *   item is good; four or more published in the 30-day window earns the full part.
 * - Discovery quality, up to 0.3. The 0 to 1 score the source earned when it was found. It is a
 *   prior: with 10 or more judged items the real record already outweighs it, so it only
 *   nudges the result. A source without one gets the neutral half.
 *
 * Fewer than MIN_JUDGED judged items is too little history: the label is "New" and the score null.
 *
 * Label thresholds: Excellent 4.5 and up, Good 3.5 and up, Fair 2.5 and up, Poor below.
 */
export const MIN_JUDGED = 10;
export const SCORE_THRESHOLDS = { excellent: 4.5, good: 3.5, fair: 2.5 } as const;

export type ScoreLabel = "Excellent" | "Good" | "Fair" | "Poor";
export type SourceScoreLabel = ScoreLabel | "New";

export interface SourceScoreInput {
  stat?: Pick<SourceStat, "fetched" | "judged" | "passed" | "published"> | undefined;
  health?: { failures: number; last_ok?: string | undefined } | undefined;
  /** Discovery quality, 0 to 1. */
  quality?: { score: number } | undefined;
  now?: Date | undefined;
}

export interface SourceScoreResult {
  score: number | null;
  label: SourceScoreLabel;
  reason: string;
}

const DAY_MS = 86_400_000;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Label for a 0 to 5 score. */
export function scoreLabel(score: number): ScoreLabel {
  if (score >= SCORE_THRESHOLDS.excellent) return "Excellent";
  if (score >= SCORE_THRESHOLDS.good) return "Good";
  if (score >= SCORE_THRESHOLDS.fair) return "Fair";
  return "Poor";
}

function failuresFactor(failures: number): number {
  if (failures <= 0) return 1;
  if (failures === 1) return 0.7;
  if (failures === 2) return 0.5;
  if (failures <= 4) return 0.25;
  return 0;
}

function recencyFactor(lastOk: string | undefined, now: Date): number {
  if (!lastOk) return 0.6;
  const at = Date.parse(lastOk);
  if (Number.isNaN(at)) return 0.6;
  const days = (now.getTime() - at) / DAY_MS;
  if (days <= 3) return 1;
  if (days <= 7) return 0.8;
  if (days <= 14) return 0.5;
  return 0.2;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function sourceScore(input: SourceScoreInput): SourceScoreResult {
  const now = input.now ?? new Date();
  const stat = input.stat;
  const judged = stat?.judged ?? 0;
  const failures = input.health?.failures ?? 0;
  const discovery = input.quality ? Math.round(input.quality.score * 100) / 100 : undefined;

  if (!stat || judged < MIN_JUDGED) {
    const seen = plural(judged, "item", "items");
    const prior =
      discovery === undefined ? "" : `; discovery scored it ${discovery.toFixed(2)} of 1`;
    return {
      score: null,
      label: "New",
      reason: `Only ${seen} judged so far${prior}.`,
    };
  }

  const passRate = stat.passed / judged;
  const publishRate = stat.published / judged;
  const yieldPart = 0.4 * clamp01(passRate / 0.5) + 0.6 * clamp01(publishRate / 0.25);
  const reliabilityPart =
    0.6 * failuresFactor(failures) + 0.4 * recencyFactor(input.health?.last_ok, now);
  const volumePart = clamp01(stat.published / 4);
  const priorPart = input.quality ? clamp01(input.quality.score) : 0.5;

  const total = 3 * yieldPart + 1.2 * reliabilityPart + 0.5 * volumePart + 0.3 * priorPart;
  const score = round1(Math.min(5, Math.max(0, total)));

  const published = `${stat.published} of ${judged} judged items published`;
  const health =
    failures > 0
      ? `${plural(failures, "failed fetch", "failed fetches")} in a row`
      : recencyFactor(input.health?.last_ok, now) <= 0.2
        ? "no fetch has worked for over two weeks"
        : "no failures";
  return { score, label: scoreLabel(score), reason: `${published}, ${health}.` };
}
