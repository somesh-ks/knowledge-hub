import type { APIRoute } from "astro";
import { handleSiteIcon, iconResponse } from "../../server/siteIcon";

export const prerender = false;

export const GET: APIRoute = async ({ url }) =>
  iconResponse(await handleSiteIcon(url.searchParams.get("url"), { fetch }));

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
