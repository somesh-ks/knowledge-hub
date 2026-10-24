import type { Item } from "@singularity/core";
import { productTokens } from "../dedupe/storyCluster.js";
import { isReleaseNote } from "./releaseNotes.js";

/**
 * A word in at most this many of the candidates' headlines is specific to a story: "mistral",
 * "coloros", "riyadh". A word in more is the beat's vocabulary ("design", "ai", "android").
 */
export const RARE_WORD_MAX_TITLES = 3;

/** Rare words two headlines must share to be one story, at least one of them not a bare number. */
export const SAME_STORY_SHARED = 2;

/**
 * Which headlines tell the same story as a better-ranked one. Fetch-time clustering joins one
 * article syndicated twice, or one launch covered by several outlets the same week; a briefing
 * still drew the same subject from two angles and two days ("Mistral Large 4 has 1T parameters"
 * and "Mistral Large 4 scores high on cyber tasks"), or two releases of one tool from a feed
 * ("ttok 1.0", "ttok 0.4"), and the listener heard the story twice (loop/results/iteration-6.md).
 *
 * Two headlines are one story when they share two words that few headlines use, or when both are
 * release notes of the same product (their first word). `ranked` is in the order to keep, best
 * first; the first of each story is kept and the ids of the rest returned.
 */
export function sameStoryRepeats(
  ranked: readonly Pick<Item, "id" | "title" | "source_type">[],
): Set<string> {
  const tokens = ranked.map((item) => productTokens(item.title));
  const titles = new Map<string, number>();
  for (const set of tokens)
    for (const token of set) titles.set(token, (titles.get(token) ?? 0) + 1);
  const rare = (token: string): boolean => (titles.get(token) ?? 0) <= RARE_WORD_MAX_TITLES;
  const first = ranked.map(
    (item) =>
      productTokens(item.title.split(/\s+/)[0] ?? "")
        .values()
        .next().value,
  );

  const repeats = new Set<string>();
  const kept: number[] = [];
  ranked.forEach((item, i) => {
    const mine = tokens[i] as Set<string>;
    const repeat = kept.some((k) => {
      const shared = [...mine].filter(
        (token) => rare(token) && (tokens[k] as Set<string>).has(token),
      );
      if (shared.length >= SAME_STORY_SHARED && shared.some((token) => /\D/.test(token)))
        return true;
      const other = ranked[k] as Pick<Item, "title" | "source_type">;
      return (
        first[i] !== undefined &&
        first[i] === first[k] &&
        rare(first[i]) &&
        isReleaseNote(item) &&
        isReleaseNote(other)
      );
    });
    if (repeat) repeats.add(item.id);
    else kept.push(i);
  });
  return repeats;
}
