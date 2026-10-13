import { parseStreamDoc, STREAM_EPISODE_ID, type StreamDoc } from "../lib/liveStream";
import { type BlobFetch, readPublicText } from "./blobStore";
import { readPublicBlobBase, readServerConfig, type ServerEnv } from "./config";
import type { ApiResult } from "./http";
import { parseRunId } from "./status";

/**
 * GET /api/stream?run=<id>: the live copy of the episode a podcast run is writing, or the answer to
 * send. The engine copies the script to Blob while it writes (streams/run-<run id>.json and
 * streams/<episode id>.json); this is how the run indicator reads it, and `streamEpisodes` is how the
 * narration lets a turn be spoken before its episode is committed.
 *
 * Guards: the site must be configured (the same check every route makes), the run id must be a run
 * id, and only a path derived from it is read, so the route cannot be used to read any other object.
 * It reads the store's public address with a query string no one has used before, because the CDN
 * serves an overwritten object from its cache for up to a minute and the whole point is to see the
 * next turns. One SIMPLE operation per read, no token, no write.
 */

/** Nothing written yet: an answer, not an error, so a page polling for it logs nothing. */
export interface StreamWaiting {
  status: "waiting";
  turns: [];
}

export type StreamBody = StreamDoc | StreamWaiting | { error: "invalid_request" | "unavailable" };

export interface StreamDeps {
  env: ServerEnv;
  fetch: BlobFetch;
  now: () => number;
  log?: (message: string) => void;
}

/** A poll is every few seconds and the answer changes with each turn: the browser keeps none. */
export const STREAM_CACHE_CONTROL = "private, no-store";

const runKey = (runId: number): string => `streams/run-${runId}.json`;
const episodeKey = (id: string): string => `streams/${id}.json`;

async function readDoc(
  deps: StreamDeps,
  base: string,
  pathname: string,
): Promise<StreamDoc | null> {
  // `t` is never used by the store; it only makes the URL one the CDN has not cached.
  const text = await readPublicText(`${base}/${pathname}?t=${deps.now()}`, deps.fetch);
  return text === null ? null : parseStreamDoc(text);
}

/** The live copy of an episode by its id, or null when there is none (or the store is not set up). */
export async function readStreamForEpisode(
  id: string,
  deps: StreamDeps,
): Promise<StreamDoc | null> {
  if (!STREAM_EPISODE_ID.test(id)) return null;
  const base = readPublicBlobBase(deps.env);
  if (base === null) return null;
  const doc = await readDoc(deps, base, episodeKey(id));
  return doc?.id === id ? doc : null;
}

export async function handleStream(
  runParam: string | null,
  deps: StreamDeps,
): Promise<ApiResult<StreamBody>> {
  if (!readServerConfig(deps.env)) return { status: 503, body: { error: "unavailable" } };
  const runId = parseRunId(runParam);
  if (runId === null) return { status: 400, body: { error: "invalid_request" } };
  const base = readPublicBlobBase(deps.env);
  if (base === null) return { status: 503, body: { error: "unavailable" } };
  try {
    const doc = await readDoc(deps, base, runKey(runId));
    // Not written yet, or the run has no live copy at all: the same answer, and the page waits. A
    // 200 rather than a 404, so each poll is not a console error.
    if (doc === null) {
      return {
        status: 200,
        headers: { "Cache-Control": STREAM_CACHE_CONTROL },
        body: { status: "waiting", turns: [] },
      };
    }
    return { status: 200, headers: { "Cache-Control": STREAM_CACHE_CONTROL }, body: doc };
  } catch (error) {
    deps.log?.(`stream failed: ${error instanceof Error ? error.message : "unknown"}`);
    return { status: 503, body: { error: "unavailable" } };
  }
}
