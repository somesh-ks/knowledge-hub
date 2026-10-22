import type { APIRoute } from "astro";
import seedSources from "../../../../../config/sources.json?raw";
// The read-only files an edit is applied against besides the stored documents (D149). Imported as
// text so they travel inside the function; the documents themselves come from the store.
import sourceCandidates from "../../../../../state/source-candidates.json?raw";
import { passphraseCheck } from "../../server/access";
import { handleConfig, handleConfigRead, MAX_CONFIG_BODY_CHARS } from "../../server/configEdit";
import { answerWithRef, toResponse } from "../../server/http";

// The site is static; this route alone runs on demand, as a Vercel Function.
export const prerender = false;

const BASE_FILES = {
  "config/sources.json": seedSources,
  "state/source-candidates.json": sourceCandidates,
};

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
        baseFiles: BASE_FILES,
      },
    );
  });

/** The owner's stored config, for pages to replace their build-time copy (D149). */
export const GET: APIRoute = () =>
  answerWithRef("api/config", (log) => handleConfigRead({ env: process.env, log }));

export const ALL: APIRoute = () =>
  toResponse({
    status: 405,
    body: { error: "method_not_allowed" },
    headers: { Allow: "GET, POST" },
  });
