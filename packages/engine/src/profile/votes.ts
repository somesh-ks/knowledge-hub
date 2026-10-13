import { hostOf, type Vote } from "./profile.js";

/** Every number that decides how far votes move a briefing, in one place. */
export const VOTE_LIMITS = {
  /** Stored votes; the newest by `at` are kept. */
  max_stored: 500,
  /** A vote counts half as much after this many days. */
  half_life_days: 30,
  /** A source or domain with fewer votes than this has no preference. */
  min_votes: 3,
  /** Largest change to a ranking score, either way (a multiplier of 0.85 to 1.15). */
  max_swing: 0.15,
  /** Recent liked and disliked headlines each, passed to the writer. */
  headlines_each: 5,
} as const;

const DAY_MS = 86_400_000;

/** A vote as an op delivers it: "clear" removes the stored vote and is never stored. */
export type IncomingVote = Omit<Vote, "value"> & { value: Vote["value"] | "clear" };

/** The stored votes with the incoming ones applied: one per story, the newest 500 kept. */
export function mergeVotes(stored: readonly Vote[], incoming: readonly IncomingVote[]): Vote[] {
  const byStory = new Map(stored.map((vote) => [vote.story_id, vote]));
  for (const vote of incoming) {
    if (vote.value === "clear") {
      byStory.delete(vote.story_id);
      continue;
    }
    byStory.set(vote.story_id, { ...vote, value: vote.value });
  }
  return [...byStory.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.story_id.localeCompare(b.story_id))
    .slice(0, VOTE_LIMITS.max_stored);
}

/** Preference in [-1, 1] per key, absent for a key with fewer than `min_votes` votes. */
export type Preferences = ReadonlyMap<string, number>;

export interface VotePreferences {
  sources: Preferences;
  domains: Preferences;
}

function tally(
  votes: readonly Vote[],
  keyOf: (vote: Vote) => string,
  now: Date,
): Map<string, number> {
  const raw = new Map<string, { count: number; net: number; weight: number }>();
  for (const vote of votes) {
    const age = Math.max(0, now.getTime() - Date.parse(vote.at));
    const decay = Number.isNaN(age) ? 0 : 0.5 ** (age / DAY_MS / VOTE_LIMITS.half_life_days);
    const key = keyOf(vote);
    const row = raw.get(key) ?? { count: 0, net: 0, weight: 0 };
    row.count += 1;
    row.net += decay * (vote.value === "up" ? 1 : -1);
    row.weight += decay;
    raw.set(key, row);
  }
  const out = new Map<string, number>();
  for (const [key, row] of raw) {
    if (row.count < VOTE_LIMITS.min_votes) continue;
    // The +1 keeps a few old votes from reading as a strong, certain preference.
    out.set(key, row.net / (row.weight + 1));
  }
  return out;
}

/** Ups minus downs with recency decay, per source and per domain. Pure. */
export function votePreferences(votes: readonly Vote[], now: Date): VotePreferences {
  return {
    sources: tally(votes, (vote) => vote.source_id, now),
    domains: tally(votes, (vote) => vote.domain, now),
  };
}

/** The ranking multiplier for an item: 1 for no preference, within 1 plus or minus `max_swing`. */
export function voteMultiplier(
  prefs: VotePreferences,
  sourceId: string,
  url: string | null,
): number {
  const domain = url === null ? null : hostOf(url);
  const lean =
    (prefs.sources.get(sourceId) ?? 0) + (domain === null ? 0 : (prefs.domains.get(domain) ?? 0));
  return 1 + VOTE_LIMITS.max_swing * Math.max(-1, Math.min(1, lean));
}

/** Where a source stands for the listing budget: below 0 skip first, above 0 keep first. */
export function sourceLean(prefs: VotePreferences, sourceId: string): number {
  return prefs.sources.get(sourceId) ?? 0;
}

/** Headlines of the newest liked and disliked votes, for the writer. */
export function tasteHeadlines(votes: readonly Vote[]): { liked: string[]; disliked: string[] } {
  const newest = [...votes]
    .filter((vote) => vote.headline.trim() !== "")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const pick = (value: Vote["value"]): string[] =>
    newest
      .filter((vote) => vote.value === value)
      .slice(0, VOTE_LIMITS.headlines_each)
      .map((vote) => vote.headline.trim());
  return { liked: pick("up"), disliked: pick("down") };
}

/** One line for the stage report saying what the votes did. */
export function voteReportLine(
  votes: readonly Vote[],
  prefs: VotePreferences,
  taste: { liked: string[]; disliked: string[] },
): string {
  const nudged = new Set([...prefs.sources.keys()]).size;
  return `votes: read ${votes.length}, nudged ${nudged} source${nudged === 1 ? "" : "s"}, passed ${taste.liked.length + taste.disliked.length} headlines`;
}
