import { createFormatClassifier } from "@dispatch/engine/source-preview";
import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleSourcePreview } from "../../server/sourcePreview";

export const prerender = false;

// Jev places the format when the server has a key (TYPESAFE_API_KEY on Vercel); without one the rule stands.
const classifier = process.env.TYPESAFE_API_KEY
  ? createFormatClassifier(process.env.TYPESAFE_API_KEY)
  : null;

export const GET: APIRoute = async ({ url, request }) =>
  toResponse(
    await handleSourcePreview(
      {
        rawUrl: url.searchParams.get("url"),
        clientKey: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
      },
      {
        fetch,
        log: (message) => console.error(`[api/source-preview] ${message}`),
        ...(classifier
          ? {
              classify: (preview) =>
                classifier.classify({
                  name: preview.name,
                  url: preview.url,
                  type: preview.type ?? "rss",
                  titles: preview.sample_titles ?? [],
                }),
            }
          : {}),
      },
    ),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
