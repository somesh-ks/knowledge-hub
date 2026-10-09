import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleModels } from "../../server/nebiusModels";

export const prerender = false;

export const GET: APIRoute = async () =>
  toResponse(
    await handleModels({
      env: process.env,
      fetch,
      log: (message) => console.error(`[api/models] ${message}`),
    }),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
