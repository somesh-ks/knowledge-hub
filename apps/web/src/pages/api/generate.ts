import type { APIRoute } from "astro";
import { guardAdmin } from "../../server/adminGuard";
import {
  contentDigestIds,
  contentDigestKind,
  contentDigestRegenerations,
} from "../../server/contentSources";
import { handleGenerate, MAX_BODY_CHARS } from "../../server/generate";
import { answerWithRef, toResponse } from "../../server/http";
import { burstCap } from "../../server/rateLimit";

// The site is static; this route alone runs on demand, as a Vercel Function.
export const prerender = false;

// A briefing is the dearest thing the site starts. Its caps (and the deletes', one per 10 s) are
// counted from GitHub's run list, which lags a dispatch by seconds, so a burst could pass them
// together; this shared per-minute cap bounds that burst, and the GitHub calls a flood would
// spend, across instances. Above the delete pace.
const STARTS_PER_MINUTE = 8;

export const POST: APIRoute = async ({ request, url }) => {
  // Owner only (D307): a briefing is the dearest thing the site starts, and a delete is a write.
  const refused = await guardAdmin(request);
  if (refused) return refused;
  return answerWithRef("api/generate", async (log) => {
    // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
    const bodyText = (await request.text()).slice(0, MAX_BODY_CHARS + 1);
    return handleGenerate(
      { bodyText, origin: request.headers.get("origin"), expectedOrigin: url.origin },
      {
        env: process.env,
        fetch,
        now: Date.now,
        delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        burst: burstCap("generate", STARTS_PER_MINUTE),
        digestIds: () => contentDigestIds(),
        digestKind: (id) => contentDigestKind(id),
        regenerations: (id) => contentDigestRegenerations(id),
        log,
      },
    );
  });
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
