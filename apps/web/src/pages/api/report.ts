import { del, head, put } from "@vercel/blob";
import type { APIRoute } from "astro";
import { createVercelBlobStore } from "../../server/blobStore";
import { readBlobCredentials } from "../../server/config";
import { toResponse } from "../../server/http";
import { handleReport, MAX_REPORT_CHARS, readCapped } from "../../server/report";
import { newVitalsBuffer, recordVital } from "../../server/vitalsStore";

export const prerender = false;

/** Where Vercel puts a function's OIDC token, when the store is connected that way (as /api/narrate). */
const OIDC_HEADER = "x-vercel-oidc-token";
/** Per instance: the Web Vitals held between two writes to the store (vitalsStore.ts). */
const vitals = newVitalsBuffer();

export const POST: APIRoute = async ({ request }) => {
  // A body with no length, or past the cap, is refused; the stream is read to the cap and no further.
  const length = request.headers.get("content-length");
  const declared = length === null ? Number.NaN : Number(length);
  const body =
    declared <= MAX_REPORT_CHARS ? await readCapped(request.body, MAX_REPORT_CHARS) : null;
  if (body === null) return toResponse({ status: 413, body: { error: "too_large" } });
  const log = (line: string): void => console.error(line);
  const result = handleReport(body, {
    log,
    now: Date.now,
    vital: (sample) =>
      recordVital(sample, vitals, {
        openBlob: () => {
          const credentials = readBlobCredentials(process.env, () =>
            request.headers.get(OIDC_HEADER),
          );
          return credentials ? createVercelBlobStore(credentials, { head, put, del }, fetch) : null;
        },
        now: Date.now,
        log,
      }),
  });
  // The write ends before the answer: a function may be frozen once it has answered.
  await result.work;
  return result.status === 204 ? new Response(null, { status: 204 }) : toResponse(result);
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
