import type { APIRoute } from "astro";
import { serveHealth } from "../../server/healthSources";
import { recordingFaults, toResponse } from "../../server/http";
import { sharedLimit } from "../../server/rateLimit";

// Runs on demand: the Health page's readings come from the content store, Neon and GitHub.
export const prerender = false;

// Open, as every route is (D160), and each answer reads GitHub and Neon: at most this many a minute
// across instances; past it the answer is 429.
const REPORTS_PER_MINUTE = 30;

const get: APIRoute = async () => {
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
