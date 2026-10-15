import type { APIRoute } from "astro";
import { handleAnthropicModels } from "../../server/anthropicModels";
import { toResponse } from "../../server/http";
import { handleModels } from "../../server/nebiusModels";

export const prerender = false;

const log = (message: string) => console.error(`[api/models] ${message}`);

/** The Nebius list, or with ?provider=anthropic the Claude list. */
export const GET: APIRoute = async ({ url }) =>
  toResponse(
    url.searchParams.get("provider") === "anthropic"
      ? await handleAnthropicModels({ env: process.env, fetch, log })
      : await handleModels({ env: process.env, fetch, log }),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
