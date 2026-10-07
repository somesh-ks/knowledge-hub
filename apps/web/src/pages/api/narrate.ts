import { verifyPassphrase } from "@dispatch/core/passphrase";
import { del, get, head, list, put } from "@vercel/blob";
import type { APIRoute } from "astro";
import { createVercelBlobStore } from "../../server/blobStore";
import { bundledDigests } from "../../server/digestSource";
import { MAX_BODY_CHARS } from "../../server/generate";
import { toResponse } from "../../server/http";
import {
  handleNarrate,
  handleNarrationLookup,
  type LookupDeps,
  startDeadline,
} from "../../server/narrate";

// The site is static; this route runs on demand, as a Vercel Function.
export const prerender = false;

/** Where Vercel puts a function's OIDC token. Only read when the store is connected that way. */
const OIDC_HEADER = "x-vercel-oidc-token";

const lookupDeps: LookupDeps = {
  env: process.env,
  openBlob: (credentials) => createVercelBlobStore(credentials, { head, get, list, put, del }),
  digests: bundledDigests,
  log: (message) => console.error(`[api/narrate] ${message}`),
};

export const GET: APIRoute = async ({ request, url }) =>
  toResponse(
    await handleNarrationLookup(
      {
        digest: url.searchParams.get("digest"),
        requestOidcToken: () => request.headers.get(OIDC_HEADER),
      },
      lookupDeps,
    ),
  );

export const POST: APIRoute = async ({ request, url }) => {
  // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
  const bodyText = (await request.text()).slice(0, MAX_BODY_CHARS + 1);
  const result = await handleNarrate(
    {
      bodyText,
      origin: request.headers.get("origin"),
      expectedOrigin: url.origin,
      requestOidcToken: () => request.headers.get(OIDC_HEADER),
    },
    {
      ...lookupDeps,
      fetch,
      now: Date.now,
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      verifyPassphrase,
      startDeadline,
    },
  );
  return toResponse(result);
};

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "GET, POST" },
  });
