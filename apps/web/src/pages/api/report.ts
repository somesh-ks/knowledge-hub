import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleReport, MAX_REPORT_CHARS, readReportBody } from "../../server/report";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // A body past the cap is refused; the stream is read to the cap and no further.
  const body = await readReportBody(
    request.headers.get("content-length"),
    request.body,
    MAX_REPORT_CHARS,
  );
  if (body === null) return toResponse({ status: 413, body: { error: "too_large" } });
  const result = handleReport(body, { log: (line) => console.error(line), now: Date.now });
  return result.status === 204 ? new Response(null, { status: 204 }) : toResponse(result);
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
