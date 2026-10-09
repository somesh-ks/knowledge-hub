import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleVoices } from "../../server/voices";

export const prerender = false;

export const GET: APIRoute = async () =>
  toResponse(
    await handleVoices({
      env: process.env,
      fetch,
      log: (message) => console.error(`[api/voices] ${message}`),
    }),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
