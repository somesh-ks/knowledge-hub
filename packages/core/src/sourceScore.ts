import type { SourceStat } from "./state.js";
import { daysBetween, stockholmDate } from "./time.js";

/**
 * Quality score of an existing source, 0 to 5 with one decimal, from three named parts of 0 to 1.
 * Pure: the caller passes the counters from state/source-stats.json, the failure record from
 * state/source-health.json and the discovery quality from config/sources.json.
 *
 * The parts:
 * - Health: does the feed keep working? Consecutive failed fetches (60 percent of the part) and
 *   how recently a fetch last worked (40 percent). Five failures in a row empty the first share;
 *   two weeks without a working fetch leave a fifth of the second.
 * - Quality: is what it publishes good enough to use? The share of judged items that passed (40
 *   percent) and that were published (60 percent): a pass rate of 50 percent and a publish rate
 *   of 25 percent each earn their full share, and a source that never reaches a digest earns
 *   nothing there. Volume is not a part and never multiplies the score: it is a confidence weight
 *   on the publish share. A source judged fewer than CONFIDENT_JUDGED times has the missing weight
 *   made up from its pass share, so a careful source that publishes rarely scores on its pass
 *   and publish quality, not on how little it sends (the old volume term, items published against
 *   four, marked such a source Fair). One judged fewer than MIN_JUDGED times has no score at all:
 *   it reads New.
 * - Trust (the owner calls it accuracy): how much of what it sends is free of hype and
 *   sponsorship. Of the items the judge asked the flag questions (a topic-only item, one a
 *   coverage topic such as Trending decides alone, is not asked), the share flagged as hype or
 *   sponsored is measured against a half: none flagged earns the whole part, half or more earns
 *   nothing. Funding is not counted: it is a subject, not a trust problem. With fewer than
 *   MIN_JUDGED items asked, or a record written before they were counted, trust is not measured
 *   yet and the part is null.
 *
 * Health and trust are hygiene and quality is the value: a source worth reading passes all three,
 * so the parts are complements, not substitutes. They combine as a geometric mean, the rule the
 * Human Development Index uses: score = 5 × cbrt(health × quality × trust), from the parts rounded
 * to two decimals, rounded to one decimal. The parts no longer add up to the score: a weak part
 * pulls it down more than a strong one lifts it, and a part of 0 makes it 0, so a healthy, clean
 * source that sends nothing worth publishing is Poor. While trust is not measured, the score is
 * 5 × sqrt(health × quality).
 *
 * A news feed of general topics alone (D66) never reaches a briefing, so for it "published" reads
 * as "covered": judged stories another outlet also carried. A story only one desk ran is the
 * news-feed version of one that never made the digest.
 *
 * Items the scoring sample judged for the score alone (D70) count toward the pass share and trust
 * like any judged item, but they could never be published. The quality above is read on the items
 * that could have been (`judged` less `sampled`), and blended with the pass share alone by their
 * share of the judged items: a source with no sampled items scores as before, one with nothing
 * that could have been published (switched off, or not yet sent by the prefilter) on its pass
 * share alone, so a switched-off source can show it has earned a place, and one in between moves
 * smoothly from one to the other.
 *
 * Fewer than MIN_JUDGED judged items is too little history: the label is "New", and the score and
 * the parts are null. One exception: a source whose own feed held fewer than MIN_JUDGED posts when
 * the sample last read it (`feed_posts`), within FEED_POSTS_FRESH_DAYS, posts too rarely to reach
 * them; with at least MIN_SPARSE judged it is scored on what it has, and the reason says so. An
 * older count no longer stands: the source has stopped needing refills.
 *
 * Label thresholds: Excellent 4.5 and up, Good 3.5 and up, Fair 2.5 and up, Poor below; on the
 * mean of the parts that is 0.9, 0.7 and 0.5. The reason names the weakest measured part when one
 * is below WEAK_PART, and says so when trust is not measured yet.
 */
export const MIN_JUDGED = 10;
/** The judged count at which the publish share is fully trusted; below it, the pass share fills in. */
export const CONFIDENT_JUDGED = 20;
/** The fewest judged items a source that posts rarely is scored on, once its feed was read (D70). */
export const MIN_SPARSE = 3;
/**
 * How long a feed's post count stands (D70): a source under the bar is read every 30 days, so this
 * leaves one missed read of slack before the score falls back to New.
 */
export const FEED_POSTS_FRESH_DAYS = 60;
/** The most a score can be: five stars, three parts of 1 (D55, back to 5 points in D103). */
export const SCORE_MAX = 5;
export const SCORE_THRESHOLDS = { excellent: 4.5, good: 3.5, fair: 2.5 } as const;
/** The share of asked items flagged as hype or sponsored at which trust reaches 0. */
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
  /**
   * How much of what it sends is free of hype and sponsorship. Null while it is not measured:
   * fewer than MIN_JUDGED items were asked the flag questions.
   */
  trust: number | null;
}

export interface SourceScoreInput {
  stat?:
    | Pick<
        SourceStat,
        | "fetched"
        | "judged"
        | "passed"
        | "published"
        | "asked"
        | "flagged"
        | "covered"
        | "sampled"
        | "sampled_at"
        | "feed_posts"
      >
    | undefined;
  /** True for a source that feeds general news topics alone: quality counts covered stories. */
  feedsGeneral?: boolean | undefined;
  health?: { failures: number; last_ok?: string | undefined } | undefined;
  /** Discovery quality, 0 to 1. Named in the reason while the source is new, and nowhere else. */
  quality?: { score: number } | undefined;
  now?: Date | undefined;
}

export interface SourceScoreResult {
  /** 0 to 5 with one decimal; null while the source is new. */
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

/** Label for a 0 to 5 score. */
export function scoreLabel(score: number): ScoreLabel {
  if (score >= SCORE_THRESHOLDS.excellent) return "Excellent";
  if (score >= SCORE_THRESHOLDS.good) return "Good";
  if (score >= SCORE_THRESHOLDS.fair) return "Fair";
  return "Poor";
}

/**
 * The score of measured parts: 5 times their geometric mean, rounded to one decimal. A part of 0
 * makes it 0. Shared with the Add source preview, so both scores follow one rule.
 */
export function combineScoreParts(parts: readonly number[]): number {
  if (parts.length === 0) return 0;
  const product = parts.reduce((total, part) => total * clamp01(part), 1);
  // cbrt and sqrt are exact where a fractional power is not (0.125 ** (1 / 3) is 0.4999...).
  const mean =
    parts.length === 3
      ? Math.cbrt(product)
      : parts.length === 2
        ? Math.sqrt(product)
        : product ** (1 / parts.length);
  return round1(Math.min(SCORE_MAX, SCORE_MAX * mean));
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
  if (days === null) return "it has not been read successfully yet";
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

/**
 * The lowest measured part below WEAK_PART, an earlier part winning a tie; null when none is that
 * low. Trust that is not measured is never named.
 */
function weakestPart(parts: SourceScoreParts): PartName | null {
  let weakest: PartName | null = null;
  let lowest = WEAK_PART;
  for (const name of PART_NAMES) {
    const value = parts[name];
    if (value === null || value >= lowest) continue;
    weakest = name;
    lowest = value;
  }
  return weakest;
}

export function sourceScore(input: SourceScoreInput): SourceScoreResult {
  const now = input.now ?? new Date();
  const stat = input.stat;
  const judged = stat?.judged ?? 0;
  const failures = input.health?.failures ?? 0;
  const discovery = input.quality ? Math.round(input.quality.score * 100) / 100 : undefined;

  // A source whose own feed held fewer than MIN_JUDGED posts when last read posts rarely: waiting
  // would not bring it to MIN_JUDGED judged items within the window.
  const posts = stat?.feed_posts;
  const readAt = stat?.sampled_at;
  const fresh =
    readAt !== undefined && daysBetween(readAt, stockholmDate(now)) <= FEED_POSTS_FRESH_DAYS;
  const sparse =
    fresh &&
    posts !== undefined &&
    posts < MIN_JUDGED &&
    judged < MIN_JUDGED &&
    judged >= MIN_SPARSE;
  if (!stat || (judged < MIN_JUDGED && !sparse)) {
    const seen = plural(judged, "item", "items");
    const prior =
      discovery === undefined
        ? ""
        : `; it scored ${Math.round(discovery * 100)} of 100 when it was found`;
    return {
      score: null,
      label: "New",
      parts: null,
      reason: `Only ${seen} judged so far${prior}.`,
    };
  }

  const days = daysSinceOk(input.health?.last_ok, now);
  const health = 0.6 * failuresFactor(failures) + 0.4 * recencyFactor(days);

  // What a judged item led to: published in a digest, or for a general news feed, carried by
  // another outlet too.
  const used = input.feedsGeneral ? (stat.covered ?? 0) : stat.published;
  // Sampled items could never be published, so the publish share is out of the rest (D70).
  const sampled = input.feedsGeneral ? 0 : Math.min(judged, stat.sampled ?? 0);
  const publishable = judged - sampled;
  const passRate = stat.passed / judged;
  const passShare = clamp01(passRate / 0.5);
  // Read on what could have been published, blended with the pass share alone by its share of the
  // judged items (D70).
  // How much the judged count backs the publish share: a source judged fewer than CONFIDENT_JUDGED
  // times leans on the pass share, so a careful low-volume source is not marked down for volume.
  const confidence = clamp01(judged / CONFIDENT_JUDGED);
  const publishShare = clamp01(used / publishable / 0.25);
  const pooled =
    publishable > 0
      ? 0.4 * passShare + 0.6 * (confidence * publishShare + (1 - confidence) * passShare)
      : 0;
  const weight = publishable / judged;
  const quality = weight * pooled + (1 - weight) * passShare;

  const asked = stat.asked ?? 0;
  const flagged = stat.flagged ?? 0;
  const parts: SourceScoreParts = {
    health: round2(clamp01(health)),
    quality: round2(clamp01(quality)),
    trust: asked >= MIN_JUDGED ? round2(1 - clamp01(flagged / asked / FLAGGED_SHARE_LIMIT)) : null,
  };
  const score = combineScoreParts(
    parts.trust === null
      ? [parts.health, parts.quality]
      : [parts.health, parts.quality, parts.trust],
  );

  const clauses: Record<PartName, string> = {
    health: healthClause(failures, days),
    quality: input.feedsGeneral
      ? `${used} of ${judged} judged stories also carried by another outlet`
      : publishable === 0
        ? `${stat.passed} of ${judged} sampled items cleared the bar`
        : sampled > 0
          ? `${used} of ${publishable} judged items published, ${sampled} more sampled`
          : `${used} of ${judged} judged items published`,
    trust: `${flagged} of ${asked} checked items flagged as hype or sponsored`,
  };
  const weakest = weakestPart(parts);
  const rarely = sparse ? `; it posts rarely, so this rests on ${judged} judged items` : "";
  const unmeasured = `${parts.trust === null ? "; trust is not measured yet" : ""}${rarely}`;
  let reason: string;
  if (weakest !== null) {
    const name = weakest.charAt(0).toUpperCase() + weakest.slice(1);
    reason = `${name} is the weakest part: ${clauses[weakest]}${unmeasured}.`;
  } else if (parts.trust !== null) {
    reason = `No weak part: ${clauses.quality}, ${clauses.health}${rarely}.`;
  } else {
    reason = `Trust is not measured yet; ${clauses.quality}, ${clauses.health}${rarely}.`;
  }
  return { score, label: scoreLabel(score), parts, reason };
}

/** The counters `scoreReasons` words, from the source's stat and failure record. */
export interface ScoreCounters {
  judged: number;
  passed: number;
  published: number;
  asked: number;
  flagged: number;
  failures: number;
}

/**
 * Up to two plain sentences on why a score is low, for the weakest parts, worst first; none when
 * the score is Good or better, or the source is new. The measure itself is unchanged: this only
 * says what the numbers mean (2026-10-25).
 */
export function scoreReasons(parts: SourceScoreParts | null, c: ScoreCounters): string[] {
  if (parts === null) return [];
  const measured =
    parts.trust === null
      ? [parts.health, parts.quality]
      : [parts.health, parts.quality, parts.trust];
  if (combineScoreParts(measured) >= SCORE_THRESHOLDS.good) return [];
  const sentence: Record<PartName, () => string> = {
    health: () =>
      c.failures > 0
        ? `Its feed failed the last ${c.failures} ${c.failures === 1 ? "fetch" : "fetches"}.`
        : "No fetch of its feed has worked lately.",
    quality: () =>
      c.judged > 0 && c.passed / c.judged < 0.25
        ? `Most of its posts don't match your categories: ${c.passed} of ${c.judged} passed.`
        : c.published === 0
          ? "None of its posts has reached a briefing yet."
          : `Few of its posts reach a briefing: ${c.published} of ${c.judged} published.`,
    trust: () =>
      `${Math.round((c.flagged / Math.max(1, c.asked)) * 10)} in 10 of its posts were flagged as hype or sponsored.`,
  };
  return PART_NAMES.filter((name) => parts[name] !== null && (parts[name] ?? 1) < WEAK_PART)
    .sort((a, b) => (parts[a] ?? 1) - (parts[b] ?? 1))
    .slice(0, 2)
    .map((name) => sentence[name]());
}
