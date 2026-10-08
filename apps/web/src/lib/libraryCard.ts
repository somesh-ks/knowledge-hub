/** What a Library card says about one briefing or episode. Build-time only: it reads the whole file. */
import type { DigestEntry } from "./digests";
import { listenLength, storyCount } from "./digestView";
import { type EpisodeEntry, FORMAT_LABELS } from "./episodes";
import { type CardFacts, normalize, type SearchIndexEntry } from "./library";

export function cardFacts(entry: DigestEntry): CardFacts {
  const { digest } = entry;
  const length = listenLength(entry);
  const parts = [storyCount(digest.items.length), length];
  if (digest.kind === "weekly") parts.unshift("Weekly");
  const lines = [digest.date, entry.player.title];
  // One line per story, headline and publisher together, so a story counts once however it matches.
  for (const item of digest.items) lines.push(`${item.headline} ${item.source}`);
  return {
    line: parts.join(", "),
    minutes: Number.parseInt(length, 10) || digest.listen_minutes,
    search: normalize(lines.join("\n")),
  };
}

/**
 * What a Library card says about one episode: its format and length ("Discussion, 5 min") and what
 * search can find (its title, its format and the stories it covers).
 */
export function episodeFacts(entry: EpisodeEntry): CardFacts {
  const { episode } = entry;
  const format = FORMAT_LABELS[episode.format];
  const lines = [episode.date, episode.title, format];
  for (const source of episode.sources) lines.push(source.headline, source.source);
  return {
    line: `${format}, ${episode.listen_minutes} min`,
    minutes: episode.listen_minutes,
    search: normalize(lines.join("\n")),
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
