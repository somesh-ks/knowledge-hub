/** What a Library card says about one briefing or episode. Build-time only: it reads the whole file. */
import type { DigestEntry } from "./digests";
import { listenLength, storyCount } from "./digestView";
import { type EpisodeEntry, FORMAT_LABELS } from "./episodes";
import { type CardFacts, normalize } from "./library";

export function cardFacts(entry: DigestEntry): CardFacts {
  const { digest } = entry;
  const length = listenLength(entry);
  const parts = [storyCount(digest.items.length), length];
  if (digest.kind === "weekly") parts.unshift("Weekly");
  const lines = [digest.date, entry.player.title];
  for (const item of digest.items) lines.push(item.headline, item.source);
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
