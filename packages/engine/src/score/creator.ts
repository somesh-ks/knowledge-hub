import { AUTHORITY_DEPTH } from "../authority/authority.js";
import { clamp01, round4 } from "./numbers.js";
import { craftFactor, penaltyFactor } from "./scoreItem.js";
import type { ScoredItem } from "./types.js";

/**
 * Lift a video from a channel the owner marked as a favorite. A creator who covers a subject has
 * already picked it and left out the rest, and the judge sees only a title and a short
 * description, which say little about a video (13 judged, none above the bar). So the video is
 * read at least at AUTHORITY_DEPTH, and the hype and sponsored flags no longer count: a sponsor
 * read is cut from the transcript by the writer, not by sinking the video. The funding flag still
 * counts, a video the judge found off-topic ("none") keeps its score, and the score never goes down.
 */
export function withCreator(scored: ScoredItem): ScoredItem {
  if (!scored.item.signals.creator_vetted || scored.topic || scored.topCategory === "none") {
    return scored;
  }
  const depth = Math.max(scored.breakdown.craftFactor, craftFactor(AUTHORITY_DEPTH));
  const penalty = penaltyFactor({ ...scored.entry.flags, hype: 0, sponsored: 0 });
  const score = round4(clamp01(scored.breakdown.taste * depth * penalty + scored.breakdown.bonus));
  if (score <= scored.score) return scored;
  return {
    ...scored,
    score,
    breakdown: {
      ...scored.breakdown,
      craftFactor: round4(depth),
      penaltyFactor: round4(penalty),
      creator: true,
    },
  };
}
