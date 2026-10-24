import { z } from "zod";
import { CoverSpec } from "./digest.js";
import { EpisodeId, PodcastFormat } from "./podcast.js";

/**
 * The episode index (D173): one small file in Blob that lists every episode, so the site can show
 * an episode as soon as it is written instead of after the next build. The engine rewrites the
 * whole file after each episode is added, replaced or removed; the site lays it over the episodes
 * its build already has. A card's worth of each episode, never the script.
 */

/** Where the index lives in the Blob store. */
export const EPISODE_INDEX_KEY = "episodes/index.json";

export const EPISODE_INDEX_VERSION = 1;

export const EpisodeIndexEntry = z.object({
  id: EpisodeId,
  title: z.string().min(1),
  format: PodcastFormat,
  listen_minutes: z.number().int().positive(),
  generated_at: z.string().datetime({ offset: true }),
  topic_ids: z.array(z.string()),
  /** What Library search reads: each story's headline and publisher. */
  stories: z.array(z.object({ headline: z.string(), source: z.string() })),
  cover: CoverSpec,
});
export type EpisodeIndexEntry = z.infer<typeof EpisodeIndexEntry>;

export const EpisodeIndex = z.object({
  version: z.literal(EPISODE_INDEX_VERSION),
  updated_at: z.string().datetime({ offset: true }),
  /** Newest first, by generated_at. */
  episodes: z.array(EpisodeIndexEntry),
});
export type EpisodeIndex = z.infer<typeof EpisodeIndex>;
