import type { APIRoute } from "astro";
import { libraryItems } from "../lib/libraryCard";
import { getSite } from "../lib/site";
import { readFromContentRepo } from "../server/contentRepo";

// Rendered on request from the content repository (D173), so a removed episode drops out of the
// list at once; the static test build prerenders it.
export const prerender = false;

/**
 * Every briefing and episode the site holds, newest first, as ids: the order the player's autoplay
 * and its Suggested list walk (player/core/suggested.ts).
 */
export const GET: APIRoute = async ({ isPrerendered }) => {
  if (!isPrerendered) {
    const unavailable = await readFromContentRepo("timeline");
    if (unavailable) return unavailable;
  }
  const { entries, episodes } = await getSite();
  const ids = libraryItems(entries, episodes).map((item) => item.id);
  return new Response(`${JSON.stringify({ ids })}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Vercel-CDN-Cache-Control": "max-age=5",
    },
  });
};
