import type { APIRoute } from "astro";
import { searchIndex } from "../lib/libraryCard";
import { getSite } from "../lib/site";
import { CONTENT_CDN_CACHE, readFromContentRepo } from "../server/contentRepo";

// Rendered on request from the content repository (D173); the static test build prerenders it.
export const prerender = false;

/** The Library's full-text search index. Fetched by the Library page when search is first used. */
export const GET: APIRoute = async ({ isPrerendered }) => {
  if (!isPrerendered) {
    const unavailable = await readFromContentRepo("search-index");
    if (unavailable) return unavailable;
  }
  const { entries, episodes } = await getSite();
  return new Response(JSON.stringify(searchIndex(entries, episodes)), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Vercel-CDN-Cache-Control": CONTENT_CDN_CACHE,
    },
  });
};
