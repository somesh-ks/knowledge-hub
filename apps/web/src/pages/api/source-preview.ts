import { createFormatClassifier } from "@dispatch/engine/source-preview";
import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { sharedLimit } from "../../server/rateLimit";
import { handleSourcePreview } from "../../server/sourcePreview";

export const prerender = false;

// Jev places the format when the server has a key (TYPESAFE_API_KEY on Vercel); without one the rule stands.
// Each placing is a paid call on an open route (D41), so the site asks at most this many a minute
// across instances; past it the rule stands.
const JEV_PER_MINUTE = 20;
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
              mayClassify: () => sharedLimit("source-preview:jev", JEV_PER_MINUTE),
            }
          : {}),
      },
    ),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
