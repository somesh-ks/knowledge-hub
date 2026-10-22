import { configStoreUrl } from "@dispatch/engine/config-paths";
import type { APIRoute } from "astro";
// The seed sources an edit is applied against besides the stored documents (D149), imported as text
// so it travels inside the function. Read only with the config store on.
import seedSources from "../../../../../config/sources.json?raw";
import { guessGate, passphraseCheck } from "../../server/access";
import { handleConfig, MAX_CONFIG_BODY_CHARS } from "../../server/configEdit";
import { answerWithRef, toResponse } from "../../server/http";
import { burstCap } from "../../server/rateLimit";

// The site is static; this route alone runs on demand, as a Vercel Function.
export const prerender = false;

// Edits wait 10 s for each other, counted from GitHub's run list or the store, either of which can
// lag a burst; this shared per-minute cap bounds it, and the calls a flood would spend, across
// instances.
const EDITS_PER_MINUTE = 12;

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
        guesses: guessGate,
        burst: burstCap("config", EDITS_PER_MINUTE),
        log,
        baseFiles: { "config/sources.json": seedSources },
      },
    );
  });

const notAllowed = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });

/** The owner's stored config for pages (D149); with the store off, the route is POST only as before. */
export const GET: APIRoute = () => {
  const storeUrl = configStoreUrl(process.env);
  if (storeUrl === null) return notAllowed();
  return answerWithRef("api/config", async (log) => {
    const { handleConfigRead } = await import("../../server/configStore");
    return handleConfigRead({ env: process.env, storeUrl, log });
  });
};

export const ALL: APIRoute = () => notAllowed();
