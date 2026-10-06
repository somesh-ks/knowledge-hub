import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleStatus } from "../../server/status";

export const prerender = false;

export const GET: APIRoute = async ({ url }) =>
  toResponse(
    await handleStatus(url.searchParams.get("run"), {
      env: process.env,
      fetch,
      log: (message) => console.error(`[api/status] ${message}`),
    }),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
