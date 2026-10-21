import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { handleReport, MAX_REPORT_CHARS } from "../../server/report";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REPORT_CHARS) {
    return toResponse({ status: 413, body: { error: "too_large" } });
  }
  const result = handleReport(await request.text(), {
    log: (line) => console.error(line),
    now: Date.now,
  });
  return result.status === 204 ? new Response(null, { status: 204 }) : toResponse(result);
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
