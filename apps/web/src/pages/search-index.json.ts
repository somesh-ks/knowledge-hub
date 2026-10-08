import type { APIRoute } from "astro";
import { searchIndex } from "../lib/libraryCard";
import { getSite } from "../lib/site";

/** The Library's full-text search index. Fetched by the Library page when search is first used. */
export const GET: APIRoute = async () => {
  const { entries, episodes } = await getSite();
  return new Response(JSON.stringify(searchIndex(entries, episodes)), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
