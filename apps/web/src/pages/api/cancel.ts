import type { APIRoute } from "astro";
import { handleCancel, MAX_CANCEL_BODY_CHARS } from "../../server/generations";
import { answerWithRef, toResponse } from "../../server/http";
import { burstCap } from "../../server/rateLimit";

export const prerender = false;

// Stopping a run is cheap and rare. The shared per-minute cap (D150) bounds a flood of attempts, and
// the GitHub calls they would spend, across instances.
const CANCELS_PER_MINUTE = 10;

export const POST: APIRoute = ({ request, url }) =>
  answerWithRef("api/cancel", async (log) => {
    // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
    const bodyText = (await request.text()).slice(0, MAX_CANCEL_BODY_CHARS + 1);
    return handleCancel(
      { bodyText, origin: request.headers.get("origin"), expectedOrigin: url.origin },
      { env: process.env, fetch, burst: burstCap("cancel", CANCELS_PER_MINUTE), log },
    );
  });

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
