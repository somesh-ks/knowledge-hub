import type { APIRoute } from "astro";
import { recordingFaults, toResponse } from "../../server/http";
import { handleStream } from "../../server/liveStream";

export const prerender = false;

const get: APIRoute = async ({ url }) =>
  toResponse(
    await handleStream(url.searchParams.get("run"), {
      env: process.env,
      fetch,
      now: Date.now,
      log: (message) => console.error(`[api/stream] ${message}`),
    }),
  );

export const GET = recordingFaults("api/stream", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
