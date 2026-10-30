import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Item, TECH_CATEGORY } from "@singularity/core";
import { z } from "zod";
import { clamp01, round4 } from "../score/numbers.js";
import { craftFactor } from "../score/scoreItem.js";
import type { ScoredItem } from "../score/types.js";

export const COMMUNITY_PATH = "config/community.json";

/**
 * What practitioners discuss outranks what a publisher announces (D240). A story people voted up
 * and argued over on Hacker News, Lobsters or Reddit is read at a higher craft depth, so a
 * first-hand announcement nobody reacted to stays under the bar and one the community took up
 * airs. The lift is a floor on depth, never a bonus on top: real technique still scores higher.
 */
export const CommunityFile = z
  .object({
    version: z.literal(1),
    /** Off until the owner signs the thresholds off: nothing below changes a score. */
    enabled: z.boolean(),
    /** Votes (see `communityVotes`) at which the lift starts; an item under it gets none. */
    min_votes: z.number().positive(),
    /** Votes at which the lift reaches its full depth. */
    full_votes: z.number().positive(),
    /** The craft depth read at full strength; half of it is read at `min_votes`. */
    max_depth: z.number().min(0).max(0.5),
  })
  .refine((file) => file.full_votes > file.min_votes, {
    message: "full_votes must be larger than min_votes",
  });
export type CommunityFile = z.infer<typeof CommunityFile>;

export const EMPTY_COMMUNITY: CommunityFile = {
  version: 1,
  enabled: false,
  min_votes: 150,
  full_votes: 1500,
  max_depth: 0.25,
};

export function parseCommunity(json: unknown): CommunityFile {
  return CommunityFile.parse(json);
}

/** Missing file means no community lift, not an error. */
export async function loadCommunity(root: string): Promise<CommunityFile> {
  let text: string;
  try {
    text = await readFile(join(root, COMMUNITY_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_COMMUNITY;
    throw error;
  }
  return parseCommunity(JSON.parse(text) as unknown);
}

/** The file read as if on, while it is off: the write stage logs what it would add. */
export function communityShadow(file: CommunityFile | undefined): CommunityFile | undefined {
  return file && !file.enabled ? { ...file, enabled: true } : undefined;
}

/** A Lobsters score counts for this many Hacker News points: its readership is far smaller. */
const LOBSTERS_WEIGHT = 5;

/**
 * Votes across every community that carried the story: points plus comments on each platform,
 * and a YouTube video's votes against its channel, summed, so a story on two platforms counts for
 * both. A comment counts as a vote because a thread people argue in is attention that a bare
 * upvote does not show.
 */
export function communityVotes(signals: Item["signals"]): number {
  const hn = (signals.hn_points ?? 0) + (signals.hn_comments ?? 0);
  const lobsters = Math.max(0, signals.lobsters_score ?? 0) * LOBSTERS_WEIGHT;
  const reddit = Math.max(0, signals.reddit_score ?? 0) + (signals.reddit_comments ?? 0);
  // Already in vote-equivalents: the fetcher scores a video against its own channel's median (D244).
  const youtube = Math.max(0, signals.youtube_votes ?? 0);
  return hn + lobsters + reddit + youtube;
}

/**
 * 0 to 1 on a log scale between `min_votes` and `full_votes`, or null under `min_votes`. Votes
 * grow by orders of magnitude, so a linear scale would let one viral thread hide every other.
 */
export function communityStrength(signals: Item["signals"], file: CommunityFile): number | null {
  const votes = communityVotes(signals);
  if (votes < file.min_votes) return null;
  return clamp01(Math.log(votes / file.min_votes) / Math.log(file.full_votes / file.min_votes));
}

/**
 * Lift a built-in score for a story the community took up. Only a built-in category that reads
 * depth from craft: a custom topic that won keeps its score, a "none" story is not about our
 * beats, and consumer tech ranks by launch scale. Hype, sponsored and funding flags still count,
 * since a loud thread rewards hype as readily as substance. The score never goes down.
 */
export function withCommunity(scored: ScoredItem, file: CommunityFile | undefined): ScoredItem {
  if (!file?.enabled || scored.topic) return scored;
  const category = scored.topCategory;
  if (category === "none" || category === TECH_CATEGORY) return scored;
  const strength = communityStrength(scored.item.signals, file);
  if (strength === null) return scored;
  const depth = file.max_depth * (0.5 + 0.5 * strength);
  const factor = Math.max(scored.breakdown.craftFactor, craftFactor(depth));
  const { taste, penaltyFactor, bonus } = scored.breakdown;
  const score = round4(clamp01(taste * factor * penaltyFactor + bonus));
  if (score <= scored.score) return scored;
  return {
    ...scored,
    score,
    breakdown: { ...scored.breakdown, craftFactor: round4(factor), community: round4(strength) },
  };
}
