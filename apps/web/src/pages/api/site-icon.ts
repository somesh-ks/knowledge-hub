import type { APIRoute } from "astro";
import { recordingFaults } from "../../server/http";
import { handleSiteIcon, iconResponse } from "../../server/siteIcon";

export const prerender = false;

const get: APIRoute = async ({ url }) =>
  iconResponse(await handleSiteIcon(url.searchParams.get("url"), { fetch }));

export const GET = recordingFaults("api/site-icon", get);

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
