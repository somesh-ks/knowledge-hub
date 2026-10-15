import type { APIRoute } from "astro";
import { passphraseCheck } from "../../server/access";
import { bundledEpisodeIds } from "../../server/episodeSource";
import { MAX_BODY_CHARS } from "../../server/generate";
import { answerWithRef, toResponse } from "../../server/http";
import { handlePodcast } from "../../server/podcast";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

export const POST: APIRoute = ({ request, url }) =>
  answerWithRef("api/podcast", async (log) => {
    // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
    const bodyText = (await request.text()).slice(0, MAX_BODY_CHARS + 1);
    return handlePodcast(
      { bodyText, origin: request.headers.get("origin"), expectedOrigin: url.origin },
      {
        env: process.env,
        fetch,
        now: Date.now,
        delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        verifyPassphrase: passphraseCheck(),
        episodeIds: bundledEpisodeIds,
        log,
      },
    );
  });

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
