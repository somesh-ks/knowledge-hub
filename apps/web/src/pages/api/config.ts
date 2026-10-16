import type { APIRoute } from "astro";
import { passphraseCheck } from "../../server/access";
import { handleConfig, MAX_CONFIG_BODY_CHARS } from "../../server/configEdit";
import { answerWithRef, toResponse } from "../../server/http";

// The site is static; this route alone runs on demand, as a Vercel Function.
export const prerender = false;

export const POST: APIRoute = ({ request, url }) =>
  answerWithRef("api/config", async (log) => {
    // Read at most a little more than the largest valid body, so a huge request cannot cost memory.
    const bodyText = (await request.text()).slice(0, MAX_CONFIG_BODY_CHARS + 1);
    return handleConfig(
      { bodyText, origin: request.headers.get("origin"), expectedOrigin: url.origin },
      {
        env: process.env,
        fetch,
        now: Date.now,
        delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        verifyPassphrase: passphraseCheck(),
        log,
      },
    );
  });

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
