import { MIN_JUDGED, type SourceStatsFile } from "@dispatch/core";
import { tasteMultiplier } from "../profile/tasteFit.js";
import { type VotePreferences, voteMultiplier } from "../profile/votes.js";
import { passRate } from "../state/sourceStats.js";
import { clamp01, round4 } from "./numbers.js";
import type { ScoredItem } from "./types.js";

/**
 * Largest change a source's record makes to an item's score, either way. Below the 0.05
 * preference bonus: a nudge between near-ties, never enough to carry an off-taste item over the
 * bar or to sink a strong one under it.
 */
export const SOURCE_ADJUSTMENT_MAX = 0.03;

/**
 * Pass rate that earns no adjustment. A source whose judged items clear the bar this often is
 * average; twice this (50 percent, the rate that earns the full yield in the 0 to 5 source score)
 * earns the full bonus, and a source where nothing passes earns the full penalty.
 */
export const SOURCE_PASS_NEUTRAL = 0.25;

/**
 * Score change for an item from its source's 30-day pass rate (state/source-stats.json). Zero for
 * a source with fewer than MIN_JUDGED judged items: too little history to hold against it.
 */
export function sourceAdjustment(stats: SourceStatsFile | undefined, sourceId: string): number {
  const stat = stats?.sources[sourceId];
  if (!stat || stat.judged < MIN_JUDGED) return 0;
  const rate = passRate(stat);
  if (rate === null) return 0;
  const offset = Math.max(-1, Math.min(1, (rate - SOURCE_PASS_NEUTRAL) / SOURCE_PASS_NEUTRAL));
  return round4(SOURCE_ADJUSTMENT_MAX * offset);
}

/**
 * The score with the source adjustment added, after custom topics, so it applies whichever
 * category or topic won. The adjustment is kept in the breakdown. Pure and deterministic.
 */
export function withSourceAdjustment(
  scored: ScoredItem,
  stats: SourceStatsFile | undefined,
): ScoredItem {
  const source = sourceAdjustment(stats, scored.item.source_id);
  if (source === 0) return scored;
  return {
    ...scored,
    score: round4(clamp01(scored.score + source)),
    breakdown: { ...scored.breakdown, source },
  };
}

/**
 * The score scaled by the owner's taste, at most 15 percent either way: Jev's taste check when it
 * answered for the item, otherwise the votes on its source and domain (profile/votes.ts), which
 * do nothing until a source or domain has three votes.
 */
export function withVoteWeight(
  scored: ScoredItem,
  prefs: VotePreferences,
  tasteFit?: number,
): ScoredItem {
  // Jev's taste check reads the headlines behind the votes, so it speaks for the source votes when
  // it answered (profile/tasteFit.ts); counting both would weigh one vote twice.
  const multiplier =
    tasteFit === undefined
      ? voteMultiplier(prefs, scored.item.source_id, scored.item.url)
      : tasteMultiplier(tasteFit);
  if (multiplier === 1) return scored;
  return { ...scored, score: round4(clamp01(scored.score * multiplier)) };
}
