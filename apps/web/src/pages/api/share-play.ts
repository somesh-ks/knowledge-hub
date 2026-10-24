import type { APIRoute } from "astro";
import { MAX_BODY_CHARS } from "../../server/generate";
import { recordingFaults, toResponse } from "../../server/http";
import { handleSharePlay } from "../../server/share";
import { playDeps } from "../../server/shareSite";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

/** One play start on the shared page: the link's checks and counts, then its files (D153). */
const post: APIRoute = async ({ request, url }) =>
  toResponse(
    await handleSharePlay(
      {
        bodyText: (await request.text()).slice(0, MAX_BODY_CHARS + 1),
        origin: request.headers.get("origin"),
        expectedOrigin: url.origin,
      },
      playDeps(),
    ),
  );

export const POST = recordingFaults("api/share-play", post);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
