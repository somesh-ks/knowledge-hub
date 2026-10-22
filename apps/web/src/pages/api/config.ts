import { configStoreUrl } from "@dispatch/engine/config-paths";
import type { APIRoute } from "astro";
// The seed sources an edit is applied against besides the stored documents (D149), and the public
// files the pages were built from, which a read compares the stored ones with: imported as text so
// they travel inside the function, from the commit the pages were built from. Read only with the
// config store on.
import builtPreferences from "../../../../../config/preferences.json?raw";
import builtOwner from "../../../../../config/profiles/owner.json?raw";
import builtSchedule from "../../../../../config/schedule.json?raw";
import seedSources from "../../../../../config/sources.json?raw";
import builtSourcesUser from "../../../../../config/sources.user.json?raw";
import builtTopics from "../../../../../config/topics.json?raw";
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
        baseFiles: { "config/sources.json": seedSources },
      },
    );
  });

const notAllowed = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });

const builtFiles = {
  "config/topics.json": builtTopics,
  "config/sources.json": seedSources,
  "config/sources.user.json": builtSourcesUser,
  "config/schedule.json": builtSchedule,
  "config/preferences.json": builtPreferences,
  "config/profiles/owner.json": builtOwner,
};

/**
 * The owner's stored config as the edits the pages lay over their built copy (D149); with the store
 * off, the route is POST only as before.
 */
export const GET: APIRoute = () => {
  const storeUrl = configStoreUrl(process.env);
  if (storeUrl === null) return notAllowed();
  return answerWithRef("api/config", async (log) => {
    const { handleConfigRead } = await import("../../server/configStore");
    return handleConfigRead({ env: process.env, storeUrl, builtFiles, log });
  });
};

export const ALL: APIRoute = () => notAllowed();
