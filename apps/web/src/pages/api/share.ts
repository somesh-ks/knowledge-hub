import type { APIRoute } from "astro";
import { MAX_BODY_CHARS } from "../../server/generate";
import { recordingFaults, toResponse } from "../../server/http";
import { requireOwner } from "../../server/ownerAuth";
import { handleShare } from "../../server/share";
import { makeDeps } from "../../server/shareSite";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

/** Where Vercel puts a function's OIDC token. Only read when the store is connected that way. */
const OIDC_HEADER = "x-vercel-oidc-token";

/** POST makes or reuses an item's share link; DELETE stops it (D153). */
const answer =
  (method: "POST" | "DELETE"): APIRoute =>
  async ({ request, url }) =>
    requireOwner(request) ??
    toResponse(
      await handleShare(
        {
          method,
          bodyText: (await request.text()).slice(0, MAX_BODY_CHARS + 1),
          origin: request.headers.get("origin"),
          expectedOrigin: url.origin,
        },
        makeDeps(() => request.headers.get(OIDC_HEADER)),
      ),
    );

export const POST = recordingFaults("api/share", answer("POST"));

export const DELETE = recordingFaults("api/share", answer("DELETE"));

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "POST, DELETE" },
  });
