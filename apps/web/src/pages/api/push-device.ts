import type { APIRoute } from "astro";
import { guardedDatabase } from "../../server/database";
import { recordingFaults, toResponse } from "../../server/http";
import { type DeviceDeps, handlePushDevice, MAX_DEVICE_BODY_CHARS } from "../../server/pushDevice";
import { burstCap } from "../../server/rateLimit";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

/** A person changes what they hear about a few times, once. */
const CHANGES_PER_MINUTE = 20;
/** A browser waits on this; Neon may be waking, so longer than the counter's 1 s. */
const DATABASE_TIMEOUT_MS = 4_000;

const database = guardedDatabase({
  databaseUrl: process.env.DATABASE_URL,
  timeoutMs: DATABASE_TIMEOUT_MS,
  log: (message) => console.error(`[api/push-device] store ${message}`),
});
const burst = burstCap("push-device", CHANGES_PER_MINUTE);
const deps = (): DeviceDeps => ({ database, burst, now: Date.now });

/** PUT: tell this browser about the Daily, the Weekly or both (D284). DELETE: stop. */
const answer =
  (method: "PUT" | "DELETE"): APIRoute =>
  async ({ request, url }) =>
    toResponse(
      await handlePushDevice(
        {
          method,
          bodyText: (await request.text()).slice(0, MAX_DEVICE_BODY_CHARS + 1),
          origin: request.headers.get("origin"),
          expectedOrigin: url.origin,
        },
        deps(),
      ),
    );

export const PUT = recordingFaults("api/push-device", answer("PUT"));

export const DELETE = recordingFaults("api/push-device", answer("DELETE"));

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "PUT, DELETE" },
  });
