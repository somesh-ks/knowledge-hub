import { COVER_MODES, type CoverMode } from "@singularity/cover";
import { type CoverSize, type CoverSource, coverVersion, episodeCover } from "../lib/covers";
import type { Site } from "../lib/site";

/**
 * A cover the build has not drawn is drawn when it is asked for (D256), by the same renderer, and
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

/** The version `vercel.json` puts first in the path when an address has no `?v=`. */
export const UNVERSIONED = "0";

/**
 * Splits `<version>/<cover path>` as the rewrite sends it. The CDN keys a cover by its path and
 * ignores the query string (measured 2026-10-30: `?v=zzzzzz` was served another address's entry), so
 * `vercel.json` moves the `?v=` into the path, where each version gets an entry of its own.
 */
export function splitVersion(path: string): { version: string; rest: string } | null {
  const slash = path.indexOf("/");
  const version = slash === -1 ? "" : path.slice(0, slash);
  return /^[a-z0-9]{1,12}$/.test(version) ? { version, rest: path.slice(slash + 1) } : null;
}

/** What to answer for a cover of `id` asked for under `version`, given the site as this instance holds it. */
export type CoverResolution =
  | { kind: "draw"; record: CoverRecord }
  /** No such briefing or episode: either a junk address or a record this instance has not read yet. */
  | { kind: "missing" }
  /** The address names a newer version than this instance holds. */
  | { kind: "behind" };

export function resolveCover(
  site: Pick<Site, "entries" | "episodes">,
  id: string,
  version: string,
): CoverResolution {
  const record = findCoverRecord(site, id);
  if (!record) return { kind: "missing" };
  if (version === UNVERSIONED || record.version === "") return { kind: "draw", record };
  const held = Number.parseInt(record.version.slice(3), 36);
  const asked = Number.parseInt(version, 36);
  // A newer version than the record held: drawing now would put the old cover under the new address.
  return asked > held ? { kind: "behind" } : { kind: "draw", record };
}

/**
 * The CDN's lifetime for a drawn cover comes from `vercel.json`'s `/covers/` header rules, not from
 * these headers (the function's `Cache-Control` is replaced, and its `Vercel-CDN-Cache-Control` was
 * not obeyed: a 404 sent `no-store` was kept). They are what the browser and a CDN that does obey
 * them see: a year only under the record's current version, a minute under any other address.
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

const YEAR_SECONDS = 31_536_000;
const SHORT_SECONDS = 60;

/** A missing cover is never kept: the record may only be a sync away, and a kept 404 would stay. */
export const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;
