import type { APIRoute } from "astro";
import { guessGate, passphraseCheck } from "../../server/access";
import { bundledEpisodeIds } from "../../server/episodeSource";
import { MAX_BODY_CHARS } from "../../server/generate";
import { answerWithRef, toResponse } from "../../server/http";
import { handlePodcast } from "../../server/podcast";
import { burstCap } from "../../server/rateLimit";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

// Episodes and deletes are counted from GitHub's run list, which lags a dispatch by seconds, so a
// burst could pass the caps together; this shared per-minute cap bounds that burst, and the GitHub
// calls a flood would spend, across instances. Above the ordinary pace (a delete every 10 s).
const REQUESTS_PER_MINUTE = 10;

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
        guesses: guessGate,
        burst: burstCap("podcast", REQUESTS_PER_MINUTE),
        episodeIds: bundledEpisodeIds,
        log,
      },
    );
  });

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
