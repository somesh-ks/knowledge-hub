import type { APIRoute } from "astro";
import type { ServerEnv } from "../../server/config";
import { guardedDatabase } from "../../server/database";
import { recordingFaults, toResponse } from "../../server/http";
import {
  handlePushKey,
  handlePushWatch,
  MAX_PUSH_BODY_CHARS,
  type PushDeps,
} from "../../server/pushWatch";
import { burstCap } from "../../server/rateLimit";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

/** Turning notifications on for a run is rare: a person starts a few a day. */
const WATCHES_PER_MINUTE = 20;
/** A browser waits on this; Neon may be waking, so longer than the counter's 1 s. */
const PUSH_DATABASE_TIMEOUT_MS = 4_000;

const database = guardedDatabase({
  databaseUrl: process.env.DATABASE_URL,
  timeoutMs: PUSH_DATABASE_TIMEOUT_MS,
  log: (message) => console.error(`[api/push] store ${message}`),
});
const burst = burstCap("push", WATCHES_PER_MINUTE);

const deps = (): PushDeps => ({
  env: process.env as ServerEnv,
  database,
  burst,
  now: Date.now,
});

/** POST: tell this browser when a run ends (D284). DELETE: stop. GET: the key to subscribe with. */
const answer =
  (method: "POST" | "DELETE"): APIRoute =>
  async ({ request, url }) =>
    toResponse(
      await handlePushWatch(
        {
          method,
          bodyText: (await request.text()).slice(0, MAX_PUSH_BODY_CHARS + 1),
          origin: request.headers.get("origin"),
          expectedOrigin: url.origin,
        },
        deps(),
      ),
    );

export const GET: APIRoute = () => toResponse(handlePushKey(process.env as ServerEnv));

export const POST = recordingFaults("api/push", answer("POST"));

export const DELETE = recordingFaults("api/push", answer("DELETE"));

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "GET, POST, DELETE" },
  });
