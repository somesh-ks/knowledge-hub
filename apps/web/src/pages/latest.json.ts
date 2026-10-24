import type { APIRoute } from "astro";
import { buildLatest } from "../lib/latest";
import { getSite } from "../lib/site";
import { readFromContentRepo } from "../server/contentRepo";

// Rendered on request from the content repository (D173), so the Create sheet sees a new briefing
// or episode go live without a build; the static test build prerenders it.
export const prerender = false;

export const GET: APIRoute = async ({ isPrerendered }) => {
  if (!isPrerendered) {
    const unavailable = await readFromContentRepo("latest");
    if (unavailable) return unavailable;
  }
  const body = buildLatest(await getSite());
  return new Response(`${JSON.stringify(body)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // The Create sheet polls this to see its run go live: the edge keeps it for seconds only.
      "Vercel-CDN-Cache-Control": "max-age=5",
    },
  });
};
