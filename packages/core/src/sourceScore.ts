import type { SourceStat } from "./state.js";

/**
 * Quality score of an existing source, 0 to 3 with one decimal: three named parts, each 0 to 1,
 * added together. Pure: the caller passes the counters from state/source-stats.json, the failure
 * record from state/source-health.json and the discovery quality from config/sources.json.
 *
 * The parts weigh the same, because each answers its own question and a source worth reading
 * passes all three:
 * - Health: does the feed keep working? Consecutive failed fetches (60 percent of the part) and
 *   how recently a fetch last worked (40 percent). Five failures in a row empty the first share;
 *   two weeks without a working fetch leave a fifth of the second.
 * - Quality: is what it publishes good enough to use? Three quarters yield, one quarter volume.
 *   Yield is the share of judged items that passed (40 percent of it) and that were published
 *   (60 percent): a pass rate of 50 percent and a publish rate of 25 percent each earn their full
 *   share, and a source that never reaches a digest earns nothing there. Volume is the items
 *   published in the 30-day window against four, because a source that yields one item a month is
 *   weak even when every item is good.
 * - Trust (the owner calls it accuracy): how much of what it sends is free of hype and
 *   sponsorship. The judge flags every judged item; the share flagged as hype or sponsored is
 *   measured against a half, so none flagged earns the whole part and half or more earns nothing.
 *   Funding is not counted: it is a subject, not a trust problem. A record written before flags
 *   were counted has no `flagged`, and trust is not measured yet: it stands at the discovery
 *   quality (the 0 to 1 score the source earned when it was found), or at the neutral half for a
 *   source without one.
 *
 * Each part is rounded to two decimals and the score is their sum rounded to one, so the parts a
 * page shows add up to the score it shows. Fewer than MIN_JUDGED judged items is too little
 * history: the label is "New", and the score and the parts are null.
 *
 * Label thresholds: Excellent 2.7 and up, Good 2.1 and up, Fair 1.5 and up, Poor below. The reason
 * names the weakest part when one is below WEAK_PART, and says so when trust is not measured yet.
 */
export const MIN_JUDGED = 10;
/** The most a score can be: three parts of 1. */
export const SCORE_MAX = 3;
export const SCORE_THRESHOLDS = { excellent: 2.7, good: 2.1, fair: 1.5 } as const;
/** The share of judged items flagged as hype or sponsored at which trust reaches 0. */
export const FLAGGED_SHARE_LIMIT = 0.5;
/** A part below this is named in the reason as the weakest one. */
export const WEAK_PART = 0.9;

export type ScoreLabel = "Excellent" | "Good" | "Fair" | "Poor";
export type SourceScoreLabel = ScoreLabel | "New";

/** The three parts of a source score, each 0 to 1 with two decimals. */
export interface SourceScoreParts {
  /** Does the feed keep working? */
  health: number;
  /** Is what it publishes good enough to use? */
  quality: number;
  /** How much of what it sends is free of hype and sponsorship. */
  trust: number;
}

export interface SourceScoreInput {
  stat?: Pick<SourceStat, "fetched" | "judged" | "passed" | "published" | "flagged"> | undefined;
  health?: { failures: number; last_ok?: string | undefined } | undefined;
  /** Discovery quality, 0 to 1. */
  quality?: { score: number } | undefined;
  now?: Date | undefined;
}

export interface SourceScoreResult {
  /** 0 to 3 with one decimal; null while the source is new. */
  score: number | null;
  label: SourceScoreLabel;
  /** Null while the source is new. */
  parts: SourceScoreParts | null;
  /** One short plain sentence behind the score. */
  reason: string;
}

const DAY_MS = 86_400_000;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Label for a 0 to 3 score. */
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

/** Days since a fetch last worked, or null when no good fetch is on record. */
function daysSinceOk(lastOk: string | undefined, now: Date): number | null {
  if (!lastOk) return null;
  const at = Date.parse(lastOk);
  return Number.isNaN(at) ? null : (now.getTime() - at) / DAY_MS;
}

function recencyFactor(days: number | null): number {
  if (days === null) return 0.6;
  if (days <= 3) return 1;
  if (days <= 7) return 0.8;
  if (days <= 14) return 0.5;
  return 0.2;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function healthClause(failures: number, days: number | null): string {
  if (failures > 0) return `${plural(failures, "failed fetch", "failed fetches")} in a row`;
  if (days === null) return "no working fetch on record";
  if (days > 14) return "no fetch has worked for over two weeks";
  if (days > 7) return "no fetch has worked for over a week";
  return "no failures";
}

const PART_NAMES = [
  "health",
  "quality",
  "trust",
] as const satisfies readonly (keyof SourceScoreParts)[];
type PartName = (typeof PART_NAMES)[number];

/** The lowest part below WEAK_PART, earlier parts winning a tie; null when none is that low. */
function weakestPart(parts: SourceScoreParts, among: readonly PartName[]): PartName | null {
  let weakest: PartName | null = null;
  for (const name of among) {
    if (parts[name] >= WEAK_PART) continue;
    if (weakest === null || parts[name] < parts[weakest]) weakest = name;
  }
  return weakest;
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
      parts: null,
      reason: `Only ${seen} judged so far${prior}.`,
    };
  }

  const days = daysSinceOk(input.health?.last_ok, now);
  const health = 0.6 * failuresFactor(failures) + 0.4 * recencyFactor(days);

  const passRate = stat.passed / judged;
  const publishRate = stat.published / judged;
  const yieldShare = 0.4 * clamp01(passRate / 0.5) + 0.6 * clamp01(publishRate / 0.25);
  const volume = clamp01(stat.published / 4);
  const quality = 0.75 * yieldShare + 0.25 * volume;

  const flagged = stat.flagged;
  const measured = flagged !== undefined;
  const trust = measured
    ? 1 - clamp01(flagged / judged / FLAGGED_SHARE_LIMIT)
    : input.quality
      ? clamp01(input.quality.score)
      : 0.5;

  const parts: SourceScoreParts = {
    health: round2(clamp01(health)),
    quality: round2(clamp01(quality)),
    trust: round2(clamp01(trust)),
  };
  const score = round1(Math.min(SCORE_MAX, parts.health + parts.quality + parts.trust));

  // Unmeasured trust is a stand-in, so it is never named as the weakest part.
  const clauses: Record<PartName, string> = {
    health: healthClause(failures, days),
    quality: `${stat.published} of ${judged} judged items published`,
    trust: `${flagged ?? 0} of ${judged} judged items flagged as hype or sponsored`,
  };
  const weakest = weakestPart(parts, measured ? PART_NAMES : ["health", "quality"]);
  let reason: string;
  if (weakest !== null) {
    const name = weakest.charAt(0).toUpperCase() + weakest.slice(1);
    const unmeasured = measured ? "" : "; trust is not measured yet";
    reason = `${name} is the weakest part: ${clauses[weakest]}${unmeasured}.`;
  } else if (measured) {
    reason = `No weak part: ${clauses.quality}, ${clauses.health}.`;
  } else {
    reason = `Trust is not measured yet; ${clauses.quality}, ${clauses.health}.`;
  }
  return { score, label: scoreLabel(score), parts, reason };
}
