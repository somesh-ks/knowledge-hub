/**
 * A day's Catch ups as one album (D219): the Catch ups of one day share one page family, and a
 * select before Play moves between them. The album is every episode with the same Stockholm date
 * (`episode.date`); D213's cap of two counts a rolling 24 hours, a separate rule. Each option is
 * named for its place in the day, in the order they were made: "Version 1", "Version 2".
 */

export interface AlbumOption {
  id: string;
  label: string;
}

/** The episode fields an album is made from. */
interface AlbumEpisode {
  id: string;
  episode: { date: string; generated_at: string };
}

/**
 * The Catch ups made on the same day as `id`, earliest first, named "Version N". Empty for a day
 * with one, which needs no select.
 */
export function catchUpAlbum(episodes: readonly AlbumEpisode[], id: string): AlbumOption[] {
  const current = episodes.find((entry) => entry.id === id);
  if (!current) return [];
  const day = episodes
    .filter((entry) => entry.episode.date === current.episode.date)
    .sort((a, b) =>
      a.episode.generated_at < b.episode.generated_at
        ? -1
        : a.episode.generated_at > b.episode.generated_at
          ? 1
          : 0,
    );
  if (day.length < 2) return [];
  return day.map((entry, index) => ({ id: entry.id, label: `Version ${index + 1}` }));
}
