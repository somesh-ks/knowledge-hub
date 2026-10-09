import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleSourcePreview } from "../../server/sourcePreview";

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) =>
  toResponse(
    await handleSourcePreview(
      {
        rawUrl: url.searchParams.get("url"),
        clientKey: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
      },
      { fetch, log: (message) => console.error(`[api/source-preview] ${message}`) },
    ),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
