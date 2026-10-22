import type { APIRoute } from "astro";
import { recordingFaults, toResponse } from "../../server/http";
import { handleStatus } from "../../server/status";

export const prerender = false;

const get: APIRoute = async ({ url }) =>
  toResponse(
    await handleStatus(url.searchParams.get("run"), {
      env: process.env,
      fetch,
      log: (message) => console.error(`[api/status] ${message}`),
    }),
  );

export const GET = recordingFaults("api/status", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
