/**
 * A day's Catch ups as one album (D218): the two a day D213 allows share one page family, and a
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

function timeOf(
  at: string,
  zone: string | undefined,
): { hour: string; minute: string; offset: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(zone ? { timeZone: zone } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(at));
  const of = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { hour: of("hour"), minute: of("minute"), offset: of("timeZoneName") };
}

/**
 * The names of a set of Catch ups, by their start times, in `zone` (the viewer's own when left out).
 * The hour is two digits ("09"), so a name is as wide as any other. Two started in one hour would
 * read the same, so every name then carries its minutes; two that still read the same (the hour the
 * clocks go back is lived twice) also carry their offset from UTC.
 */
export function albumLabels(ats: readonly string[], zone?: string): string[] {
  const times = ats.map((at) => timeOf(at, zone));
  const distinct = (key: (time: (typeof times)[number]) => string) =>
    new Set(times.map(key)).size === times.length;
  const withMinutes = !distinct((time) => time.hour);
  const withOffset = withMinutes && !distinct((time) => `${time.hour}:${time.minute}`);
  return times.map(
    ({ hour, minute, offset }) =>
      `Catch up at ${hour}${withMinutes ? `:${minute}` : ""}${withOffset ? ` (${offset})` : ""}`,
  );
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
