import { verifyPassphrase } from "@dispatch/core/passphrase";
import type { APIRoute } from "astro";
import { handleConfig, MAX_CONFIG_BODY_CHARS } from "../../server/configEdit";
import { toResponse } from "../../server/http";

// The site is static; this route alone runs on demand, as a Vercel Function.
export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
  const bodyText = (await request.text()).slice(0, MAX_CONFIG_BODY_CHARS + 1);
  const result = await handleConfig(
    { bodyText, origin: request.headers.get("origin"), expectedOrigin: url.origin },
    {
      env: process.env,
      fetch,
      now: Date.now,
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      verifyPassphrase,
      log: (message) => console.error(`[api/config] ${message}`),
    },
  );
  return toResponse(result);
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
