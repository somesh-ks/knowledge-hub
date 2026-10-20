/**
 * Episodes saved for offline listening: the list kept beside the files, and which one goes when
 * there are too many. Pure, so the order is checked without a browser. The files themselves are in
 * Cache Storage (scripts/libraryDownloads.ts) and the service worker (public/sw.js) plays them.
 */

/** The cache the files live in. The service worker names the same one and keeps it across versions. */
export const AUDIO_CACHE = "dispatch-audio-v1";
/** Where the list is kept inside that cache. Not a page: nothing requests it. */
export const MANIFEST_KEY = "/__downloads.json";
/** More than this and the oldest download is removed. */
export const MAX_DOWNLOADS = 10;

export interface Download {
  id: string;
  /** The audio file's address, as the player asks for it. */
  audio: string;
  /** The page that opens offline. */
  page: string;
  /** Every other address saved for it (its covers). */
  extras: string[];
}

/** The list with `entry` newest. A second download of the same item moves it to the end. */
export function addDownload(
  list: readonly Download[],
  entry: Download,
  max = MAX_DOWNLOADS,
): { list: Download[]; evicted: Download[] } {
  const next = [...list.filter((item) => item.id !== entry.id), entry];
  const cut = Math.max(0, next.length - max);
  return { list: next.slice(cut), evicted: next.slice(0, cut) };
}

/** Every address a download put in the cache. */
export function addressesOf(download: Download): string[] {
  return [download.audio, download.page, ...download.extras];
}

/** Reads the saved list, dropping anything that is not shaped like an entry. */
export function parseDownloads(text: string): Download[] {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is Download =>
        typeof item?.id === "string" &&
        typeof item.audio === "string" &&
        typeof item.page === "string" &&
        Array.isArray(item.extras),
    );
  } catch {
    return [];
  }
}
