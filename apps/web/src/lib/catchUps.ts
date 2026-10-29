/**
 * A day's Catch ups as one album (D216): the two a day D213 allows share one page family, and a
 * select before Play moves between them. The album is every episode with the same Stockholm date,
 * the date the server counts the cap in. Each option is named for the hour it was started in the
 * viewer's own time zone ("Catch up at 14"), which the page script sets for that visit only
 * (scripts/catchUpAlbum.ts); the server draws Stockholm's hour, so the page is whole without script.
 *
 * Nothing here may import build-time code: this file ships to the browser with the page script.
 */

export const ALBUM_ZONE = "Europe/Stockholm";

export interface AlbumOption {
  id: string;
  /** When the episode was made, ISO: the page script names the option from it in the browser's zone. */
  at: string;
  label: string;
}

/** The episode fields an album is made from. */
interface AlbumEpisode {
  id: string;
  episode: { date: string; generated_at: string };
}

function timeOf(at: string, zone: string | undefined): { hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(zone ? { timeZone: zone } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const of = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { hour: of("hour"), minute: of("minute") };
}

/**
 * The names of a set of Catch ups, by their start times, in `zone` (the viewer's own when left out).
 * The hour is two digits ("09"), so a name is as wide at 9 as at 14. Two started in one hour would
 * read the same, so every name then carries its minutes.
 */
export function albumLabels(ats: readonly string[], zone?: string): string[] {
  const times = ats.map((at) => timeOf(at, zone));
  const clash = new Set(times.map((time) => time.hour)).size < times.length;
  return times.map(({ hour, minute }) => `Catch up at ${hour}${clash ? `:${minute}` : ""}`);
}

/**
 * The Catch ups made on the same day as `id`, earliest first, named by the hour. Empty for a day
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
  const labels = albumLabels(
    day.map((entry) => entry.episode.generated_at),
    ALBUM_ZONE,
  );
  return day.map((entry, index) => ({
    id: entry.id,
    at: entry.episode.generated_at,
    label: labels[index] ?? "Catch up",
  }));
}
