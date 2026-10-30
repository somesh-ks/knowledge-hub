import { COVER_MODES, type CoverMode } from "@singularity/cover";
import { type CoverSize, type CoverSource, coverVersion, episodeCover } from "../lib/covers";
import type { Site } from "../lib/site";

/**
 * A cover the build has not drawn is drawn when it is asked for (D251), by the same renderer, and
 * kept by Vercel's CDN. It used to be drawn after each content sync and stored in Blob: nine writes
 * for each new briefing or episode, against Hobby's 2,000 a month. This is the part with logic:
 * which cover an address names, and how long each answer may be kept.
 */

export interface CoverRequest {
  id: string;
  size: CoverSize;
  format: "webp" | "png";
  /** Set for the theme variants (`dark/<id>-512.webp`); unset for the cover as authored. */
  mode?: CoverMode;
}

const ADDRESS = /^(?:(light|dark)\/)?([A-Za-z0-9][A-Za-z0-9-]*)-(512|1024)\.(webp|png)$/;

/** What `/covers/<path>` asks for, or null for anything the build never served at that address. */
export function parseCoverPath(path: string): CoverRequest | null {
  const match = ADDRESS.exec(path);
  if (!match) return null;
  const [, mode, id, size, format] = match;
  // The theme variants are WebP only, as in the build.
  if (mode !== undefined && format !== "webp") return null;
  if (mode !== undefined && !COVER_MODES.includes(mode as CoverMode)) return null;
  return {
    id: id as string,
    size: Number(size) as CoverSize,
    format: format as "webp" | "png",
    ...(mode ? { mode: mode as CoverMode } : {}),
  };
}

export interface CoverRecord {
  source: CoverSource;
  /** The `?v=` the record's own address carries, or "" for a record with no time. */
  version: string;
}

/** The briefing or episode a cover belongs to, as the content repository holds it now. */
export function findCoverRecord(
  site: Pick<Site, "entries" | "episodes">,
  id: string,
): CoverRecord | null {
  const entry = site.entries.find((candidate) => candidate.digest.id === id);
  if (entry) {
    return { source: entry.digest, version: coverVersion(entry.digest.generated_at) };
  }
  const episode = site.episodes.find((candidate) => candidate.id === id);
  if (episode) {
    return { source: episodeCover(episode), version: coverVersion(episode.episode.generated_at) };
  }
  return null;
}

const YEAR_SECONDS = 31_536_000;
const SHORT_SECONDS = 60;

/**
 * How long a drawn cover may be kept. Only an address whose `?v=` is the record's current version
 * names one cover for good. An older version (the record was regenerated since) and an address with
 * no version are answered with the current cover for a minute only: kept for a year, they would
 * keep showing the old cover under the new record. The CDN keeps a function's answer only when told
 * so, in `Vercel-CDN-Cache-Control`; `Cache-Control` is for the browser.
 */
export function coverCacheHeaders(
  requestedVersion: string,
  record: CoverRecord,
): Record<string, string> {
  const current = record.version !== "" && requestedVersion === record.version.slice(3);
  const seconds = current ? YEAR_SECONDS : SHORT_SECONDS;
  return {
    "Cache-Control": current
      ? `public, max-age=${seconds}, immutable`
      : `public, max-age=${seconds}`,
    "Vercel-CDN-Cache-Control": `max-age=${seconds}`,
  };
}

/** A missing cover is never kept: the record may only be a sync away, and a kept 404 would stay. */
export const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;
