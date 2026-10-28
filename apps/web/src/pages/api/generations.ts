import type { APIRoute } from "astro";
import { handleGenerations } from "../../server/generations";
import { answerWithRef, toResponse } from "../../server/http";
import { burstCap } from "../../server/rateLimit";

export const prerender = false;

// The list costs GitHub calls (the run lists, and each run's steps), and it is polled while open: a
// shared per-minute cap bounds a flood across instances (D150), well above one open list's pace.
const LISTS_PER_MINUTE = 40;
const burst = burstCap("generations", LISTS_PER_MINUTE);

export const GET: APIRoute = () =>
  answerWithRef("api/generations", async (log) => {
    const wait = await burst();
    if (wait > 0) {
      return {
        status: 429,
        headers: { "Retry-After": String(wait) },
        body: { error: "cooldown", retry_after_s: wait },
      };
    }
    return handleGenerations({ env: process.env, fetch, log });
  });

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
