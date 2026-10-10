import { parseSegmentMarks, type SegmentMarks } from "../lib/segmentMarks";
import type { NarrateError } from "../types/contracts";
import { type BlobFetch, readPublicText } from "./blobStore";
import { readPublicBlobBase } from "./config";
import type { ApiResult } from "./http";
import {
  handleNarrationLookup,
  LOOKUP_CACHE_CONTROL,
  type LookupDeps,
  parseDigestId,
} from "./narrate";
import { SEGMENT_KEY, segmentMarksPath } from "./narrateSegments";
import { describeError } from "./redact";

/**
 * GET /api/narrate-marks?digest=<id>&segment=<key>: when each word of one narrated segment is said,
 * for the transcript to light the word being spoken.
 *
 * Like the lookup, anyone may call it, so it holds no store credentials and can spend no advanced
 * operation. The marks' address is worked out the way the lookup works out the audio's (the hash of
 * the segment's current text and voice), so a caller can only ever name a file this site would have
 * written. It is read by its public URL: one SIMPLE operation when the CDN has not seen it, free
 * when it has.
 */

export interface MarksInput {
  digest: string | null;
  segment: string | null;
  /** The name of every query parameter in the request, repeats included. */
  params: readonly string[];
}

export type MarksDeps = LookupDeps & { fetch: BlobFetch };

export type NarrateMarksResponse = ({ status: 200 } & SegmentMarks) | NarrateError;

/**
 * Marks at an address named by a hash never change. A new deployment, which any change of voice
 * needs, empties Vercel's cache, so the edge may keep them for good; the browser keeps them a day.
 */
export const MARKS_CACHE_CONTROL = "public, max-age=86400, s-maxage=31536000";

/** A turn's marks are a few kilobytes. Anything near this is not a file this site wrote. */
const MAX_MARKS_BYTES = 512_000;

const invalid: ApiResult<NarrateMarksResponse> = {
  status: 400,
  body: { status: 400, error: "invalid_request" },
};
const unavailable: ApiResult<NarrateMarksResponse> = {
  status: 503,
  body: { status: 503, error: "unavailable" },
};
// Not narrated yet, narrated before marks were kept, or Speechify gave none: the page estimates.
// Briefly cached, as the lookup is: marks may be written a moment later.
const noMarks: ApiResult<NarrateMarksResponse> = {
  status: 404,
  headers: { "Cache-Control": LOOKUP_CACHE_CONTROL },
  body: { status: 404, error: "segment_not_found" },
};

export async function handleNarrationMarks(
  input: MarksInput,
  deps: MarksDeps,
): Promise<ApiResult<NarrateMarksResponse>> {
  const log = deps.log ?? (() => {});
  // `digest` and `segment`, once each, are the whole query: anything else only gets past the cache.
  const names = [...input.params].sort();
  if (names.length !== 2 || names[0] !== "digest" || names[1] !== "segment") return invalid;
  const id = parseDigestId(input.digest);
  if (id === null || input.segment === null || !SEGMENT_KEY.test(input.segment)) return invalid;

  // The lookup knows each segment's current text and voice, and asks the store nothing.
  const lookup = await handleNarrationLookup({ digest: id, params: ["digest"] }, deps);
  if (lookup.body.status !== 200 || !("segments" in lookup.body)) {
    return { status: lookup.status, body: lookup.body as NarrateError };
  }
  const segment = lookup.body.segments.find((candidate) => candidate.key === input.segment);
  if (!segment) return noMarks;
  const base = readPublicBlobBase(deps.env);
  const audioUrl = segment.audio?.url;
  if (!base || !audioUrl?.startsWith(`${base}/`)) return unavailable;

  let text: string | null;
  try {
    text = await readPublicText(segmentMarksPath(audioUrl), deps.fetch, MAX_MARKS_BYTES);
  } catch (error) {
    log(`marks of ${id} ${input.segment} could not be read: ${describeError(error, [])}`);
    return unavailable;
  }
  if (text === null) return noMarks;
  let marks: SegmentMarks | null = null;
  try {
    marks = parseSegmentMarks(JSON.parse(text));
  } catch {
    marks = null;
  }
  if (marks === null) {
    log(`marks of ${id} ${input.segment} are not in the expected shape`);
    return noMarks;
  }
  return {
    status: 200,
    headers: { "Cache-Control": MARKS_CACHE_CONTROL },
    body: { status: 200, ...marks },
  };
}
