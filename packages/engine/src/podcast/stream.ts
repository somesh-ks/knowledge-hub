import type { Episode, PodcastRequest } from "@singularity/core";
import { paletteAccent } from "@singularity/cover";
import type { Logger } from "../context.js";
import type { BlobClient } from "../publish/blob.js";
import { episodeTitle } from "./episode.js";
import { discussionHostNames } from "./prompt.js";
import type { PodcastStory, ScriptTurn } from "./types.js";

/**
 * The script of an episode while it is being written, kept in Vercel Blob so the site can start
 * narrating the opening turns long before the committed file is deployed. The committed episode
 * stays the source of truth: this copy is temporary and best effort, and a failure to write it never
 * fails the run.
 *
 * Two copies of one document are written, because two readers know different things. The run
 * indicator knows the workflow run id from the moment it asks for the episode; the narration route
 * knows only the episode id. `streams/run-<run id>.json` and `streams/<episode id>.json`.
 */
export const STREAM_PREFIX = "streams/";
/** Vercel Blob's floor for a cache lifetime. The site reads by a versioned URL, so it is never stale. */
const STREAM_CACHE_SECONDS = 60;
/** A stream older than this belongs to a run that is long over; the next run removes it. */
export const STREAM_KEEP_MS = 24 * 3_600_000;
const DELETE_BATCH = 50;

export type StreamStatus = "writing" | "done" | "failed";

export interface StreamDoc {
  id: string;
  title: string;
  status: StreamStatus;
  /** The turns written so far, in order. Only ever extended: an earlier turn is not rewritten. */
  turns: { speaker: "a" | "b"; text: string; item_id?: string }[];
  /** What narrating the turns needs: the voices and the hosts' names. */
  voices: { a: string | null; b: string | null };
  hosts: { a: string; b: string } | null;
  format: PodcastRequest["format"];
  /** The stories the turns refer to, for the player's list. */
  stories: { item_id: string; headline: string; source: string; url: string; section: string }[];
  /**
   * The colour the player's cover box takes until the drawn cover is deployed (the same one the
   * committed episode gets, `paletteAccent(...).light`). Without it a live episode shows the site's
   * accent on a generic mark for the minutes between Play and the deploy.
   */
  cover_key?: string;
  updated_at: string;
}

export const streamKeyForEpisode = (id: string): string => `${STREAM_PREFIX}${id}.json`;
export const streamKeyForRun = (runId: string): string => `${STREAM_PREFIX}run-${runId}.json`;

export interface StreamPublisher {
  /** The turns of the opening, written as soon as they are complete. */
  opening(turns: readonly ScriptTurn[]): Promise<void>;
  /** The whole script, before it is committed. */
  script(turns: readonly ScriptTurn[]): Promise<void>;
  /** After the committed script has been pushed. */
  done(): Promise<void>;
  /** On any error. */
  failed(): Promise<void>;
}

export interface StreamPublisherInput {
  client: BlobClient;
  runId: string;
  episodeId: string;
  request: PodcastRequest;
  stories: readonly PodcastStory[];
  /** The cover chosen for the episode; its colour goes into the live copy. */
  cover?: Episode["cover"];
  now: () => Date;
  log?: Logger;
}

/** The cover's placeholder colour, or undefined for a palette the cover package does not know. */
function coverKeyOf(cover: Episode["cover"] | undefined): string | undefined {
  if (!cover) return undefined;
  try {
    return paletteAccent(cover.palette).light;
  } catch {
    return undefined;
  }
}

/**
 * Writes are queued one after another, so the order they were asked in is the order they land in:
 * a slow opening can never overwrite the finished script. Blob write failures are caught; errors
 * constructing a document or thrown by the supplied clock or logger propagate.
 */
export function createStreamPublisher(input: StreamPublisherInput): StreamPublisher {
  const { client, request } = input;
  let turns: StreamDoc["turns"] = [];
  let status: StreamStatus = "writing";
  let last: Promise<void> = Promise.resolve();
  const hosts = request.format === "discussion" ? discussionHostNames(request) : null;
  const coverKey = coverKeyOf(input.cover);

  const document = (): StreamDoc => ({
    id: input.episodeId,
    title: episodeTitle(request),
    status,
    turns,
    voices: { a: request.voice_id ?? null, b: request.voice_id_b ?? null },
    hosts,
    format: request.format,
    stories: input.stories.map((story) => ({
      item_id: story.item_id,
      headline: story.headline,
      source: story.source,
      url: story.url,
      section: story.section,
    })),
    ...(coverKey ? { cover_key: coverKey } : {}),
    updated_at: input.now().toISOString(),
  });

  function write(): Promise<void> {
    const body = new TextEncoder().encode(JSON.stringify(document()));
    const options = { contentType: "application/json", cacheControlMaxAge: STREAM_CACHE_SECONDS };
    const attempt = async (): Promise<void> => {
      try {
        await Promise.all([
          client.put(streamKeyForEpisode(input.episodeId), body, options),
          client.put(streamKeyForRun(input.runId), body, options),
        ]);
      } catch (error) {
        input.log?.warn("The live copy of the script could not be written", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    };
    last = last.then(attempt);
    return last;
  }

  const plain = (list: readonly ScriptTurn[]): StreamDoc["turns"] =>
    list.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
      ...(turn.item_id ? { item_id: turn.item_id } : {}),
    }));

  return {
    opening(list) {
      turns = plain(list);
      return write();
    },
    script(list) {
      turns = plain(list);
      return write();
    },
    done() {
      status = "done";
      return write();
    },
    failed() {
      status = "failed";
      return write();
    },
  };
}

/**
 * Deletes streams last written over a day ago, so the store does not collect them. Best effort: the
 * run starts with it and never waits on a failure. One list and at most a few deletes.
 */
export async function pruneStreams(client: BlobClient, now: Date, log?: Logger): Promise<number> {
  try {
    const stale: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.list({ prefix: STREAM_PREFIX, ...(cursor ? { cursor } : {}) });
      for (const blob of page.blobs) {
        if (blob.uploadedAt.getTime() < now.getTime() - STREAM_KEEP_MS) stale.push(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor !== undefined);
    for (let index = 0; index < stale.length; index += DELETE_BATCH) {
      await client.del(stale.slice(index, index + DELETE_BATCH));
    }
    return stale.length;
  } catch (error) {
    log?.warn("Old live scripts could not be removed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return 0;
  }
}
