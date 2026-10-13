import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleStream } from "../../server/liveStream";

export const prerender = false;

export const GET: APIRoute = async ({ url }) =>
  toResponse(
    await handleStream(url.searchParams.get("run"), {
      env: process.env,
      fetch,
      now: Date.now,
      log: (message) => console.error(`[api/stream] ${message}`),
    }),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
