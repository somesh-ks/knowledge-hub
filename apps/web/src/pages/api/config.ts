import { configStoreUrl } from "@singularity/engine/config-paths";
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
import type { BuiltConfigFiles } from "../../lib/configHash";
import { handleConfig, MAX_CONFIG_BODY_CHARS } from "../../server/configEdit";
import { answerWithRef, toResponse } from "../../server/http";
import { requireOwner } from "../../server/ownerAuth";
import { burstCap } from "../../server/rateLimit";

// The podcast structure (D170) is absent until the owner first edits one, so it is globbed: a
// missing file is an empty match, not a failed build.
const structureFile = import.meta.glob<string>("../../../../../config/structure.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
const builtStructure = Object.values(structureFile)[0];

// The site is static; this route alone runs on demand, as a Vercel Function.
export const prerender = false;

// Edits wait 10 s for each other, counted from GitHub's run list or the store, either of which can
// lag a burst; this shared per-minute cap bounds it, and the calls a flood would spend, across
// instances.
const EDITS_PER_MINUTE = 12;

export const POST: APIRoute = ({ request, url }) =>
  requireOwner(request) ??
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
        burst: burstCap("config", EDITS_PER_MINUTE),
        log,
        baseFiles: { "config/sources.json": seedSources },
      },
    );
  });

const notAllowed = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });

// Typed by BUILT_CONFIG_PATHS, so the digest the pages carry covers exactly the files diffed from.
const builtFiles: BuiltConfigFiles = {
  "config/topics.json": builtTopics,
  "config/sources.json": seedSources,
  "config/sources.user.json": builtSourcesUser,
  "config/schedule.json": builtSchedule,
  "config/preferences.json": builtPreferences,
  "config/profiles/owner.json": builtOwner,
  "config/structure.json": builtStructure,
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
