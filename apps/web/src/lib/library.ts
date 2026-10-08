/**
 * The Library: every briefing and podcast episode as album art, with search, sort and filter. The page is static HTML;
 * these pure functions decide what a card says and which cards a query keeps, and are shared by the
 * build (the card's facts) and the page script (the matching), so the two cannot disagree.
 *
 * Nothing here may import build-time code: this file ships to the browser with the page script.
 */

export type LibraryFilter = "all" | "daily" | "weekly" | "custom";
export type LibrarySort = "newest" | "oldest" | "longest" | "stories";

export const LIBRARY_FILTERS: ReadonlyArray<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "custom", label: "Custom" },
];

/** The `kind` of a briefing made on request, with the Generate button, instead of on schedule. */
const ON_DEMAND_KIND = "on-demand";

export const LIBRARY_SORTS: ReadonlyArray<{ id: LibrarySort; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "longest", label: "Longest first" },
  { id: "stories", label: "Most stories" },
];

/** The `kind` a podcast episode's card carries, beside the kinds of briefing. */
export const EPISODE_KIND = "episode";

/** What search, sort and filter need to know about one card. Read from its data attributes. */
export interface CardData {
  date: string;
  /** The card's place in the page's own order, newest first. Tells apart two cards of one day. */
  order: number;
  kind: string;
  stories: number;
  minutes: number;
  hasAudio: boolean;
  /** Lower-case text: the date, the title, then one line per story (headline and publisher). */
  search: string;
}

export interface CardFacts {
  /** The line under the title: "12 stories, 8 min". Weekly briefings say so first. */
  line: string;
  minutes: number;
  search: string;
}

/** Lower case, accents folded, so "cafe" finds "Café". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchesFilter(card: CardData, filter: LibraryFilter): boolean {
  // Custom is everything made on request: podcast episodes and briefings from the Generate button.
  const custom = card.kind === EPISODE_KIND || card.kind === ON_DEMAND_KIND;
  if (filter === "weekly") return card.kind === "weekly";
  if (filter === "custom") return custom;
  if (filter === "daily") return card.kind !== "weekly" && !custom;
  return true;
}

/**
 * How many lines of a card's text hold every word of the query. Zero means the card does not match.
 * An empty query matches every card once.
 */
export function matchCount(card: CardData, query: string): number {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let count = 0;
  for (const line of card.search.split("\n")) {
    if (words.every((word) => line.includes(word))) count += 1;
  }
  return count;
}

export function compareCards(a: CardData, b: CardData, sort: LibrarySort): number {
  const newest = b.date.localeCompare(a.date) || a.order - b.order;
  if (sort === "oldest") return -newest;
  if (sort === "longest") return b.minutes - a.minutes || newest;
  if (sort === "stories") return b.stories - a.stories || newest;
  return newest;
}

/** "3 results", "1 result", "1 of 5 results", or "No results". Announced after every change. */
export function resultSummary(shown: number, total: number): string {
  if (shown === 0) return "No results";
  // After "of", the noun counts the whole list, not the part shown.
  if (shown !== total) return `${shown} of ${total} results`;
  return shown === 1 ? "1 result" : `${shown} results`;
}
