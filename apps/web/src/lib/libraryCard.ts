/** What a Library card says about one briefing or episode. Build-time only: it reads the whole file. */
import type { DigestEntry } from "./digests";
import { listenLength, storyCount } from "./digestView";
import { type EpisodeEntry, FORMAT_LABELS } from "./episodes";
import { longDate } from "./format";
import {
  type CardFacts,
  dateSearchLine,
  factsLine,
  normalize,
  type SearchIndexEntry,
  STORY_SOURCE_SEPARATOR,
} from "./library";

/**
 * The kind a briefing's line starts with. One made on request sits under Episodes, so its line
 * follows an episode's pattern, its format then its length: "Podcast · 4 min".
 */
export function briefingKindLabel(kind: string): string {
  if (kind === "weekly") return "Weekly";
  if (kind === "on-demand") return "Podcast";
  return "Daily";
}

/** A story's line in a card's search text: the headline, then its publisher, kept apart. */
function storyLine(headline: string, source: string): string {
  return `${headline.replace(/\s+/g, " ")}${STORY_SOURCE_SEPARATOR}${source.replace(/\s+/g, " ")}`;
}

/**
 * What a Library card says about one briefing, in the one pattern every card follows, kind then
 * contents then length: "Daily · 12 stories · 8 min". Search finds its date (in any form), its
 * title and kind, then each story.
 */
export function cardFacts(entry: DigestEntry): CardFacts {
  const { digest } = entry;
  const length = listenLength(entry);
  const meta = [
    dateSearchLine(digest.date, longDate(digest.date)),
    entry.player.title,
    briefingKindLabel(digest.kind),
  ];
  const lines = [...meta];
  // One line per story, headline and publisher together, so a story counts once however it matches.
  for (const item of digest.items) lines.push(storyLine(item.headline, item.source));
  const stories = digest.kind === "on-demand" ? undefined : storyCount(digest.items.length);
  return {
    line: factsLine([briefingKindLabel(digest.kind), stories, length]),
    minutes: Number.parseInt(length, 10) || digest.listen_minutes,
    search: lines.join("\n"),
    metaLines: meta.length,
  };
}

/**
 * What a Library card says about one episode, in the same pattern: "Discussion · 5 min". Its format
 * says it is an episode, as a briefing's kind says it is one, and the line stays short enough for the
 * narrowest card to hold it on one line. Search finds its date (in any form), its title and format,
 * then each story it covers.
 */
export function episodeFacts(entry: EpisodeEntry): CardFacts {
  const { episode } = entry;
  const format = FORMAT_LABELS[episode.format];
  const meta = [
    dateSearchLine(episode.date, longDate(episode.date)),
    episode.title,
    `episode ${format}`,
  ];
  const lines = [...meta];
  for (const source of episode.sources) lines.push(storyLine(source.headline, source.source));
  return {
    line: factsLine([format, `${episode.listen_minutes} min`]),
    minutes: episode.listen_minutes,
    search: lines.join("\n"),
    metaLines: meta.length,
  };
}

/**
 * The full text behind every card, for the Library's search: an episode's whole script and every
 * story of a briefing, with what the host says aloud. One normalized blob per item. It goes in its
 * own file (/search-index.json), fetched when search is first used, so no page carries it.
 */
export function searchIndex(
  entries: readonly DigestEntry[],
  episodes: readonly EpisodeEntry[],
): SearchIndexEntry[] {
  const briefings = entries.map((entry): SearchIndexEntry => {
    const parts: string[] = [];
    // A story is one line, so a query's words have to meet in one story.
    for (const item of entry.digest.items) {
      const words = [item.headline, item.source, item.summary, item.spoken ?? "", item.why ?? ""];
      parts.push(words.join(" ").replace(/\s+/g, " "));
    }
    return { id: entry.id, kind: "briefing", text: normalize(parts.join("\n")) };
  });
  const scripts = episodes.map((entry): SearchIndexEntry => {
    const parts: string[] = [];
    for (const turn of entry.episode.turns) parts.push(turn.text.replace(/\s+/g, " "));
    return { id: entry.id, kind: "episode", text: normalize(parts.join("\n")) };
  });
  return [...briefings, ...scripts];
}

export type LibraryItem =
  | { kind: "briefing"; id: string; entry: DigestEntry }
  | { kind: "episode"; id: string; entry: EpisodeEntry };

/** Briefings and episodes in one list, newest first: by day, then by when each was written. */
export function libraryItems(
  entries: readonly DigestEntry[],
  episodes: readonly EpisodeEntry[],
): LibraryItem[] {
  const items: Array<LibraryItem & { date: string; writtenAt: string }> = [
    ...entries.map((entry) => ({
      kind: "briefing" as const,
      id: entry.id,
      entry,
      date: entry.digest.date,
      writtenAt: entry.digest.generated_at,
    })),
    ...episodes.map((entry) => ({
      kind: "episode" as const,
      id: entry.id,
      entry,
      date: entry.episode.date,
      writtenAt: entry.episode.generated_at,
    })),
  ];
  return items.sort(
    (a, b) => b.date.localeCompare(a.date) || b.writtenAt.localeCompare(a.writtenAt),
  );
}
