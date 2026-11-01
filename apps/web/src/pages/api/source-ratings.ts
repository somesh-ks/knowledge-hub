import type { APIRoute } from "astro";
// The sources and topics the pages were built from, bundled into the function (as api/config.ts does),
// so a rating is computed for the same list the page shows.
import seedSources from "../../../../../config/sources.json?raw";
import builtSourcesUser from "../../../../../config/sources.user.json?raw";
import builtTopics from "../../../../../config/topics.json?raw";
import { recordingFaults, toResponse } from "../../server/http";
import { handleSourceRatings, runtimeState } from "../../server/sourceRatings";

// The site is static; this route alone runs on demand, and its answer is held at the edge.
export const prerender = false;

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const get: APIRoute = async () =>
  toResponse(
    await handleSourceRatings({
      state: runtimeState,
      config: {
        topicsFile: json(builtTopics),
        registry: json(seedSources),
        user: json(builtSourcesUser),
      },
    }),
  );

export const GET = recordingFaults("api/source-ratings", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
