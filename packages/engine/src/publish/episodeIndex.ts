import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EPISODE_INDEX_KEY,
  EPISODE_INDEX_VERSION,
  type EpisodeIndex,
  type EpisodeIndexEntry,
  episodeRelPath,
  parseEpisodeFile,
} from "@singularity/core";
import type { BlobClient } from "./blob.js";
import { listEpisodeIds } from "./publishEpisodes.js";

/**
 * Writes the episode index (D173, core episodeIndex.ts) from the episode files on disk. It is
 * rebuilt whole each time rather than patched, so a missed write heals on the next one and the
 * index can never drift from Podcasts/.
 */

/**
 * The shortest edge cache Vercel Blob allows. The URL is fixed, so readers add a query string the
 * CDN has not seen (as server/liveStream.ts does) and never wait this long.
 */
export const EPISODE_INDEX_CACHE_SECONDS = 60;

export interface BuiltEpisodeIndex {
  index: EpisodeIndex;
  /** Files that would not parse, left out of the index; the build skips them too. */
  skipped: string[];
}

export async function buildEpisodeIndex(root: string, now: Date): Promise<BuiltEpisodeIndex> {
  const episodes: EpisodeIndexEntry[] = [];
  const skipped: string[] = [];
  for (const id of await listEpisodeIds(root)) {
    const relPath = episodeRelPath(id);
    try {
      const episode = parseEpisodeFile(await readFile(join(root, relPath), "utf8"));
      episodes.push({
        id: episode.id,
        title: episode.title,
        format: episode.format,
        listen_minutes: episode.listen_minutes,
        generated_at: episode.generated_at,
        topic_ids: episode.request.topic_ids,
        stories: episode.sources.map(({ headline, source }) => ({ headline, source })),
        cover: episode.cover,
      });
    } catch {
      skipped.push(relPath);
    }
  }
  episodes.sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at));
  return {
    index: { version: EPISODE_INDEX_VERSION, updated_at: now.toISOString(), episodes },
    skipped,
  };
}

/** Rebuild the index from disk and upload it. Returns what was written. */
export async function publishEpisodeIndex(
  client: BlobClient,
  root: string,
  now: Date,
): Promise<BuiltEpisodeIndex> {
  const built = await buildEpisodeIndex(root, now);
  await client.put(EPISODE_INDEX_KEY, new TextEncoder().encode(JSON.stringify(built.index)), {
    contentType: "application/json",
    cacheControlMaxAge: EPISODE_INDEX_CACHE_SECONDS,
  });
  return built;
}
