import type { APIRoute } from "astro";
import { handleCron } from "../../../server/cron";
import { toResponse } from "../../../server/http";

// Vercel Cron calls this once in every UTC hour (vercel.json, D61).
export const prerender = false;

export const GET: APIRoute = async ({ request }) =>
  toResponse(
    await handleCron(request.headers.get("authorization"), {
      env: process.env,
      fetch,
      now: () => new Date(),
      log: (message) => console.error(`[api/cron/run] ${message}`),
    }),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
