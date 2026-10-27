import type { APIRoute } from "astro";
import { MAX_BODY_CHARS } from "../../../server/generate";
import { recordingFaults, toResponse } from "../../../server/http";
import { FORGET_COOKIE, isEnforced, isTrusted, trustDevice } from "../../../server/ownerAuth";
import { burstCap } from "../../../server/rateLimit";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

// Guessing the token is the only attack on this route; a shared cap bounds it across instances.
const TRIES_PER_MINUTE = 10;
const tries = burstCap("owner-device", TRIES_PER_MINUTE);

const noContent = (headers?: Record<string, string>) =>
  new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...headers } });

/** Whether the site asks for the owner's secret and whether this device holds it. */
const get: APIRoute = ({ request }) =>
  toResponse({
    status: 200,
    body: { enforced: isEnforced(), trusted: isTrusted(request) },
  });

/** "Trust this device": the right token in, the owner cookie out (D197). */
const post: APIRoute = async ({ request, url }) => {
  const wait = await tries();
  if (wait > 0) {
    return toResponse({
      status: 429,
      body: { error: "cooldown", retry_after_s: wait },
      headers: { "Retry-After": String(wait) },
    });
  }
  const result = trustDevice({
    bodyText: (await request.text()).slice(0, MAX_BODY_CHARS + 1),
    origin: request.headers.get("origin"),
    expectedOrigin: url.origin,
  });
  return result.status === 204 ? noContent(result.headers) : toResponse(result);
};

/** Forget this device. */
const del: APIRoute = () => noContent({ "Set-Cookie": FORGET_COOKIE });

export const GET = recordingFaults("api/owner/device", get);
export const POST = recordingFaults("api/owner/device", post);
export const DELETE = recordingFaults("api/owner/device", del);

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "GET, POST, DELETE" },
  });
