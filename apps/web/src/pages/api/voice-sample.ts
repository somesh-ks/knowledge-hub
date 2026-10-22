import type { APIRoute } from "astro";
import { recordingFaults, toResponse } from "../../server/http";
import { byteRange, handleVoiceSample, SAMPLE_CACHE_CONTROL } from "../../server/voices";

export const prerender = false;

const get: APIRoute = async ({ request, url }) => {
  const sample = await handleVoiceSample(url.searchParams.get("voice"), {
    env: process.env,
    fetch,
    log: (message) => console.error(`[api/voice-sample] ${message}`),
  });
  if (sample.kind === "error") return toResponse(sample.result);
  const { body, contentType } = sample;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": SAMPLE_CACHE_CONTROL,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  const range = byteRange(request.headers.get("range"), body.byteLength);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${body.byteLength}` },
    });
  }
  if (range === null) return new Response(body, { status: 200, headers });
  const [start, end] = range;
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${body.byteLength}` },
  });
};

export const GET = recordingFaults("api/voice-sample", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
