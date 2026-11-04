import { parseStreamDoc, STREAM_EPISODE_ID, type StreamDoc } from "../lib/liveStream";
import { type BlobFetch, readPublicText } from "./blobStore";
import { readPublicBlobBase, readServerConfig, type ServerEnv } from "./config";
import type { ApiResult } from "./http";
import { parseRunId } from "./status";

/**
 * GET /api/stream?run=<id>: the live copy of the episode a podcast run is writing, or the answer to
 * send. The engine copies the script to Blob while it writes, one object per stage
 * (streams/run-<run id>.<stage>.json and streams/<episode id>.<stage>.json); this is how the run
 * indicator reads it, and `streamEpisodes` is how the narration lets a turn be spoken before its
 * episode is committed.
 *
 * Guards: the site must be configured (the same check every route makes), the run id must be a run
 * id, and only paths derived from it are read, so the route cannot be used to read any other object.
 * The CDN serves an overwritten object for up to a minute whatever the query string (measured
 * 2026-11-04: a new `?t=` was a cache hit 8 s old), and Blob's list is as stale, so each stage is
 * written once under a name of its own: `part-1`, `part-2` and so on, then `done` or `failed`. The
 * parts are walked up to the first that is missing, beside the two ends; done or failed wins (D366).
 * SIMPLE operations only (one per part, and three more), no token, no write.
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
  log?: (message: string) => void;
}

/** A poll is every few seconds and the answer changes with each turn: the browser keeps none. */
export const STREAM_CACHE_CONTROL = "private, no-store";

/** An episode writes two to four parts (packages/engine/src/podcast/stream.ts); this caps a walk. */
const MAX_PARTS = 20;

/** The latest stage written under `stem` (streams/run-<id> or streams/<episode id>), or null. */
async function readDoc(deps: StreamDeps, base: string, stem: string): Promise<StreamDoc | null> {
  // A stage not written yet is a 404, which the CDN does not keep.
  const read = (stage: string): Promise<string | null> =>
    readPublicText(`${base}/${stem}.${stage}.json`, deps.fetch);
  // Each part holds every turn before it, so the last one before a gap is the latest.
  const walk = async (): Promise<StreamDoc | null> => {
    let latest: StreamDoc | null = null;
    for (let part = 1; part <= MAX_PARTS; part++) {
      const text = await read(`part-${part}`).catch((error: unknown) => {
        if (latest === null) throw error;
        return null;
      });
      if (text === null) break;
      latest = parseStreamDoc(text) ?? latest;
    }
    return latest;
  };
  // One read that fails does not hide a stage that was read; only when none was is it passed on.
  const reads = await Promise.allSettled([read("done"), read("failed"), walk()]);
  let failure: unknown = null;
  for (const result of reads) {
    if (result.status === "rejected") {
      failure ??= result.reason;
      continue;
    }
    const doc = typeof result.value === "string" ? parseStreamDoc(result.value) : result.value;
    if (doc) return doc;
  }
  if (failure !== null) throw failure;
  return null;
}

/** The live copy of an episode by its id, or null when there is none (or the store is not set up). */
export async function readStreamForEpisode(
  id: string,
  deps: StreamDeps,
): Promise<StreamDoc | null> {
  if (!STREAM_EPISODE_ID.test(id)) return null;
  const base = readPublicBlobBase(deps.env);
  if (base === null) return null;
  const doc = await readDoc(deps, base, `streams/${id}`);
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
    const doc = await readDoc(deps, base, `streams/run-${runId}`);
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
