/**
 * Episodes saved for offline listening: the list kept beside the files, and which one goes when
 * there are too many. Pure, so the order is checked without a browser. The files themselves are in
 * Cache Storage (scripts/libraryDownloads.ts) and the service worker (public/sw.js) plays them.
 */

/** The cache the files live in. The service worker names the same one and keeps it across versions. */
export const AUDIO_CACHE = "singularity-audio-v1";
/** Where downloads were kept before the rename (D179). The worker deletes it once it has moved them. */
export const OLD_AUDIO_CACHE = "dispatch-audio-v1";
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

/**
 * The cached audio, word marks and lookups no saved download names: what a page killed mid-save
 * left behind. The worker serves every key of the cache offline, and `removeDownload` deletes only
 * what an entry lists, so these would sit in the storage quota for good. Pages, covers and the
 * scripts kept for them are left alone.
 */
export function unlistedPayloads(
  keys: readonly string[],
  list: readonly Download[],
  base: string,
): string[] {
  const named = new Set(list.flatMap(addressesOf).map((address) => new URL(address, base).href));
  return keys.filter((key) => {
    if (named.has(key)) return false;
    const { pathname } = new URL(key);
    return (
      /\.(mp3|m4a|opus)$/.test(pathname) ||
      pathname === "/api/narrate" ||
      pathname === "/api/narrate-marks"
    );
  });
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

/** Thrown when an episode has a turn whose file is not stored yet: a download never narrates. */
export class NotReadyError extends Error {
  constructor() {
    super("not ready");
  }
}

/**
 * An item's covers: the page's, drawn for each theme (lib/covers.ts themedCoverSrc), and the
 * player's and lock screen's, as authored. A theme switch offline still finds its cover.
 */
export function coverAddresses(id: string): string[] {
  return ["", "/light", "/dark"].flatMap((mode) =>
    [512, 1024].map((size) => `/covers${mode}/${id}-${size}.webp`),
  );
}

/** The lookup the player asks for, which a downloaded episode's page gets answered from the cache. */
export function lookupAddress(id: string): string {
  return `/api/narrate?digest=${encodeURIComponent(id)}`;
}

/** The word marks of one turn, at the address the player asks for. */
export function marksAddress(id: string, segment: string): string {
  return `/api/narrate-marks?${new URLSearchParams({ digest: id, segment })}`;
}

/** What the lookup lists for one turn: the file's address, or null when none is worked out. */
export interface LookupSegment {
  key: string;
  audio?: { url?: unknown; confirmed?: unknown } | null;
}

/**
 * The files of an episode's turns, in order, from a lookup body. Null when the body is not a
 * lookup or any turn has no address, so a caller treats it as not ready.
 */
export function segmentUrls(body: unknown): { key: string; url: string }[] | null {
  const segments = (body as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const found: { key: string; url: string }[] = [];
  for (const segment of segments as LookupSegment[]) {
    const url = segment?.audio?.url;
    if (typeof segment?.key !== "string" || typeof url !== "string" || url === "") return null;
    found.push({ key: segment.key, url });
  }
  return found;
}

/**
 * The lookup as saved with the files: every turn confirmed, because the download fetched each one.
 * Offline the player then plays the addresses instead of asking /api/narrate to narrate a turn.
 */
export function confirmLookup(body: Record<string, unknown>): Record<string, unknown> {
  const segments = Array.isArray(body.segments) ? body.segments : [];
  return {
    ...body,
    segments: segments.map((segment: LookupSegment) => ({
      ...segment,
      audio: segment.audio ? { ...segment.audio, confirmed: true } : segment.audio,
    })),
  };
}
