/**
 * Which catalogue sources suit a topic being added. Pure, and free of imports, so the Topics page
 * script can bundle it without pulling in anything else.
 *
 * A source is offered when a word of the topic's name or description is also one of its tags. The
 * more tags a topic's words hit, the better the match; ties are broken by name.
 */

export interface Offer {
  name: string;
  /** Lowercase words describing what the source covers. */
  tags: readonly string[];
}

/** How many suggestions the page shows at most. */
export const MAX_SUGGESTIONS = 6;

/**
 * A plural and its singular are one word: "interfaces" and "interface", "launches" and "launch",
 * "stories" and "story". Words of three letters or fewer are left alone.
 */
function fold(word: string): string {
  if (word.length <= 3) return word;
  if (/(ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The distinct lowercase words in some text, with plurals folded. */
export function wordsOf(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) if (word) words.add(fold(word));
  return words;
}

/** How many of an offer's tags appear among the words of the topic. */
export function matchScore(topicWords: ReadonlySet<string>, tags: readonly string[]): number {
  const own = new Set(tags.map((tag) => fold(tag.toLowerCase())));
  let score = 0;
  for (const tag of own) if (topicWords.has(tag)) score += 1;
  return score;
}

/** The offers that match the topic's name and description, best first, at most `limit`. */
export function matchOffers<T extends Offer>(
  topic: { name: string; description: string },
  offers: readonly T[],
  limit: number = MAX_SUGGESTIONS,
): T[] {
  const words = wordsOf(`${topic.name} ${topic.description}`);
  return offers
    .map((offer) => ({ offer, score: matchScore(words, offer.tags) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.offer.name.localeCompare(b.offer.name, "en"),
    )
    .slice(0, limit)
    .map((entry) => entry.offer);
}
