import type { APIRoute } from "astro";
import { loadManage } from "../../lib/manage";
import { loadSourceCatalog } from "../../lib/sourceCatalog";

/**
 * The source catalogue and the sites already read, built with the site. A topic added on the Topics
 * page has no page until the next build, so the page loads this on the first Add and ranks the
 * catalogue for the new topic in the browser, with the same suggestSources the build uses for a
 * topic's page (lib/sourceCatalogMatch.ts). `held` is what suggestSources leaves out: each source's
 * site and address.
 */
export const GET: APIRoute = async () => {
  const [{ sources }, catalog] = await Promise.all([loadManage(), loadSourceCatalog()]);
  const body = {
    sources: catalog,
    held: sources.map((source) => ({ host: source.host, url: source.url })),
  };
  return new Response(`${JSON.stringify(body)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
