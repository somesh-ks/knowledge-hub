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
  { id: "custom", label: "Episodes" },
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
  /**
   * Normalized text (see `normalize`), a line each: the date, the title and the kind come first (see
   * `metaLines`), then one line per story (headline and publisher).
   */
  search: string;
  /** How many of the first lines of `search` are about the card itself, not one of its stories. */
  metaLines?: number;
}

export interface CardFacts {
  /** The line under the title: "Daily · 12 stories · 8 min", "Discussion · 5 min". */
  line: string;
  minutes: number;
  /**
   * The lines `CardData.search` is made of, as written: the page normalizes them, and names a
   * matching story by its headline (the part before `STORY_SOURCE_SEPARATOR`) as it was written.
   */
  search: string;
  /** How many of the first lines of `search` are about the card itself (see `CardData`). */
  metaLines: number;
}

/** What parts a story's headline from its publisher on its line of search text. */
export const STORY_SOURCE_SEPARATOR = "\t";

/** A story's headline, from its line of search text. */
export function storyHeadline(line: string): string {
  return line.split(STORY_SOURCE_SEPARATOR)[0] ?? "";
}

/** What separates the parts of the line under a title. One separator, everywhere. */
export const FACT_SEPARATOR = " · ";

/** Joins the parts of a card's line: kind, what is in it, how long. Empty parts are left out. */
export function factsLine(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(FACT_SEPARATOR);
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
  const { meta, stories } = matchDetail(card, query);
  return meta + stories;
}

/**
 * Where a query matched on one card: `meta` lines about the card itself (its date, title, kind) and
 * `stories`, the lines of its stories. Only stories are worth reporting as "matching stories"; a card
 * that matched on its own date or title keeps its normal facts line. An empty query matches once, as meta.
 */
export function matchDetail(
  card: CardData,
  query: string,
): { meta: number; stories: number; first?: number } {
  const words = queryWords(query);
  if (words.length === 0) return { meta: 1, stories: 0 };
  const firstStory = card.metaLines ?? 0;
  let meta = 0;
  let stories = 0;
  let first: number | undefined;
  card.search.split("\n").forEach((line, index) => {
    if (!lineHasWords(line, words)) return;
    if (index < firstStory) meta += 1;
    else {
      stories += 1;
      // The first story that matched, by its line in `search`, so the card can name it.
      first ??= index;
    }
  });
  return first === undefined ? { meta, stories } : { meta, stories, first };
}

function queryWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/**
 * True when a line holds every word. A number is a whole token, never part of one: "6" finds
 * "6 october" but not "2026", so a day of the month does not match every card's year.
 */
function lineHasWords(line: string, words: readonly string[]): boolean {
  let tokens: string[] | null = null;
  return words.every((word) => {
    if (!/^\d+$/.test(word)) return line.includes(word);
    tokens ??= line.split(/[^\p{L}\p{N}]+/u);
    return tokens.includes(word);
  });
}

/** The search text for a day, so "7 october", "oct 7", "2026-10-07" and "wednesday" all find it. */
export function dateSearchLine(isoDate: string, longDate: string): string {
  const [, , day = ""] = isoDate.split("-");
  // Split on any space: the day and the month are joined by a non-breaking one.
  const monthName = longDate.split(/\s+/)[2] ?? "";
  return `${isoDate} ${longDate} ${monthName.slice(0, 3)} ${Number(day)}`;
}

/** What the list says when no card is on show, and the one button that undoes it. */
export interface EmptyCopy {
  message: string;
  /** What the button's label says it resets. */
  action: string;
  /** Which controls the button resets. */
  resets: "search" | "everything";
}

const FILTER_NOUNS: Record<Exclude<LibraryFilter, "all">, string> = {
  daily: "daily briefings",
  weekly: "weekly briefings",
  custom: "episodes",
};

/** The sentence for an empty list: no match for a search, nothing of a kind, or both together. */
export function emptyCopy(query: string, filter: LibraryFilter): EmptyCopy {
  const text = query.trim();
  if (text !== "") {
    if (filter === "all") {
      return { message: `No results for “${text}”`, action: "Clear search", resets: "search" };
    }
    return {
      message: `No results for “${text}” in ${FILTER_NOUNS[filter]}`,
      action: "Show all",
      resets: "everything",
    };
  }
  const noun = filter === "all" ? "briefings or episodes" : FILTER_NOUNS[filter];
  return { message: `No ${noun} yet`, action: "Show all", resets: "everything" };
}

/**
 * True when one line of a long text holds every word of the query: a turn of an episode's script,
 * one story of a briefing. `text` is already normalized, a line each (the search index is built that
 * way). An empty query matches nothing: the cards' own lines answer that.
 */
export function textHasWords(text: string, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return false;
  return text.split("\n").some((line) => lineHasWords(line, words));
}

/** One entry of /search-index.json: what a card's full text holds, normalized. */
export interface SearchIndexEntry {
  id: string;
  kind: "briefing" | "episode";
  text: string;
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
