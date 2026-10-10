import type { APIRoute } from "astro";
import { withSecondVoice } from "../../server/config";
import { bundledDigests } from "../../server/digestSource";
import { bundledEpisodes } from "../../server/episodeSource";
import { toResponse } from "../../server/http";
import { handleNarrationMarks } from "../../server/narrateMarks";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

const log = (message: string): void => console.error(`[api/narrate-marks] ${message}`);

// Like the lookup it is given no store: the marks are read by their public URL with a plain fetch.
export const GET: APIRoute = async ({ url }) =>
  toResponse(
    await handleNarrationMarks(
      {
        digest: url.searchParams.get("digest"),
        segment: url.searchParams.get("segment"),
        params: [...url.searchParams.keys()],
      },
      {
        env: withSecondVoice(process.env),
        digests: bundledDigests,
        episodes: bundledEpisodes,
        log,
        fetch,
      },
    ),
  );

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "GET" },
  });
