import type { APIRoute } from "astro";
import { guardAdmin } from "../../server/adminGuard";
import { serveHealth } from "../../server/healthSources";
import { recordingFaults, toResponse } from "../../server/http";
import { sharedLimit } from "../../server/rateLimit";

// Runs on demand: the Health page's readings come from the content store, Neon and GitHub.
export const prerender = false;

// Not open: it answers only the command center's session (D257). Each answer reads GitHub and Neon:
// at most this many a minute across instances; past it the answer is 429.
const REPORTS_PER_MINUTE = 30;

const get: APIRoute = async ({ request }) => {
  const refused = await guardAdmin(request);
  if (refused) return refused;
  if (!(await sharedLimit("health", REPORTS_PER_MINUTE))) {
    return toResponse({
      status: 429,
      body: { error: "rate_limited" },
      headers: { "Retry-After": "60" },
    });
  }
  return toResponse({ status: 200, body: await serveHealth(new Date()) });
};

export const GET = recordingFaults("api/health", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
