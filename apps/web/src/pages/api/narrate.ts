import { del, head, put } from "@vercel/blob";
import type { APIRoute } from "astro";
import { createVercelBlobStore } from "../../server/blobStore";
import { withSecondVoice } from "../../server/config";
import { bundledDigests } from "../../server/digestSource";
import { bundledEpisodes } from "../../server/episodeSource";
import { MAX_BODY_CHARS } from "../../server/generate";
import { toResponse } from "../../server/http";
import { readStreamForEpisode } from "../../server/liveStream";
import { handleNarrate, handleNarrationLookup, startDeadline } from "../../server/narrate";
import { burstCap } from "../../server/rateLimit";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

/** Where Vercel puts a function's OIDC token. Only read when the store is connected that way. */
const OIDC_HEADER = "x-vercel-oidc-token";

// Narration's spend is held by the daily cap and the monthly budget, both counted in Blob, but a
// flood still costs function time and Blob reads; this shared per-minute cap bounds it across
// instances (D150). A page sends one request at a time (segmentQueue.ts): the turn the playhead
// needs and the three after it (trackAudio.ts's look-ahead), then one per turn as it plays. A
// briefing is 11 to 16 turns of about 25 s, so 2 or 3 a minute; a live episode asks for every one
// of its short turns, about 20 a minute at double speed; each skip adds up to 4. One a second leaves
// a bad minute of skipping, a second device and a prewarm room.
const NARRATIONS_PER_MINUTE = 60;

const log = (message: string): void => console.error(`[api/narrate] ${message}`);

/** An episode still being written is read from its live copy in the store (server/liveStream.ts). */
const liveEpisodesFor = () => (id: string) =>
  readStreamForEpisode(id, { env: process.env, fetch, now: Date.now, log });

// The lookup is given no store at all: anyone may call it, and it must not be able to spend.
export const GET: APIRoute = async ({ url }) =>
  toResponse(
    await handleNarrationLookup(
      { digest: url.searchParams.get("digest"), params: [...url.searchParams.keys()] },
      {
        env: withSecondVoice(process.env),
        digests: bundledDigests,
        episodes: bundledEpisodes,
        liveEpisodes: liveEpisodesFor(),
        log,
      },
    ),
  );

export const POST: APIRoute = async ({ request, url }) => {
  // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
  const bodyText = (await request.text()).slice(0, MAX_BODY_CHARS + 1);
  const result = await handleNarrate(
    {
      bodyText,
      origin: request.headers.get("origin"),
      expectedOrigin: url.origin,
      requestOidcToken: () => request.headers.get(OIDC_HEADER),
    },
    {
      env: withSecondVoice(process.env),
      // The store's files are read by URL with the plain fetch; everything else goes through the SDK.
      openBlob: (credentials) => createVercelBlobStore(credentials, { head, put, del }, fetch),
      digests: bundledDigests,
      episodes: bundledEpisodes,
      liveEpisodes: liveEpisodesFor(),
      log,
      fetch,
      now: Date.now,
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      burst: burstCap("narrate", NARRATIONS_PER_MINUTE),
      startDeadline,
    },
  );
  return toResponse(result);
};

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "GET, POST" },
  });
