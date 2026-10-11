import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleTopicSuggestions } from "../../server/topicSuggestions";

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) =>
  toResponse(
    await handleTopicSuggestions(
      {
        topicId: url.searchParams.get("id"),
        clientKey: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
      },
      { fetch, log: (message) => console.error(`[api/topic-suggestions] ${message}`) },
    ),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
