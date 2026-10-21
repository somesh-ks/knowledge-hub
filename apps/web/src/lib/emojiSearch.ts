import { fallbackEmoji, TOPIC_EMOJIS } from "@dispatch/core/topicEmoji";

/** One emoji of the picker's data (public/emoji.json, scripts/buildEmoji.ts): the emoji, its name and its extra keywords. */
export type EmojiItem = readonly [emoji: string, name: string, keywords: string];

export interface EmojiGroup {
  name: string;
  emoji: EmojiItem[];
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The emoji whose name or keywords hold every word typed, each as the start of one of their words
 * ("ind" finds India), best first: a name's word before a keyword, a whole word before a start.
 * Order within a score is the data's.
 */
export function searchEmoji(groups: readonly EmojiGroup[], query: string): EmojiItem[] {
  const typed = words(query);
  if (typed.length === 0) return [];
  const scored: { item: EmojiItem; score: number }[] = [];
  for (const group of groups) {
    for (const item of group.emoji) {
      const named = words(item[1]);
      const keyed = words(item[2]);
      let score = 0;
      for (const word of typed) {
        const best = Math.max(
          ...named.map((n) => (n === word ? 4 : n.startsWith(word) ? 3 : 0)),
          ...keyed.map((k) => (k === word ? 2 : k.startsWith(word) ? 1 : 0)),
        );
        if (best === 0) {
          score = 0;
          break;
        }
        score += best;
      }
      if (score > 0) scored.push({ item, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map(({ item }) => item);
}

/**
 * The picker's Suggested row for a topic: the emoji it has, the name's own guess (a flag for a place),
 * the topic emoji whose meaning shares a word with the name, best first, then, once the list has
 * loaded, the best matches in it for each word of the name. The rest of the topic emoji fill the row,
 * so it is never a lone emoji. No repeats.
 */
export function suggestedEmoji(
  name: string,
  current: string,
  groups: readonly EmojiGroup[] = [],
  limit = 8,
): string[] {
  const typed = words(name);
  const ranked = Object.entries(TOPIC_EMOJIS)
    .filter(([emoji]) => emoji !== "✨")
    .map(([emoji, about]) => {
      const meaning = words(about);
      return {
        emoji,
        // A short word must match whole ("ai" is not "air"); a longer one may start a word.
        score: typed.filter((word) =>
          meaning.some((m) => m === word || (word.length >= 4 && m.startsWith(word))),
        ).length,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ emoji }) => emoji);
  const found = typed
    .filter((word) => word.length >= 3)
    .flatMap((word) =>
      searchEmoji(groups, word)
        .slice(0, 2)
        .map((item) => item[0]),
    );
  const rest = Object.keys(TOPIC_EMOJIS).filter((emoji) => emoji !== "✨");
  return [...new Set([current, fallbackEmoji(name), ...ranked, ...found, ...rest])]
    .filter((emoji) => emoji !== "")
    .slice(0, limit);
}
