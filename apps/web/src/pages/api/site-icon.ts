import type { APIRoute } from "astro";
import { recordingFaults } from "../../server/http";
import { handleSiteIcon, iconResponse } from "../../server/siteIcon";

export const prerender = false;

const get: APIRoute = async ({ url }) =>
  iconResponse(await handleSiteIcon(url.searchParams.get("url"), { fetch }));

// The caller picks the host this fetches, so its 502 and 504 are that host's, not the site's.
export const GET = recordingFaults("api/site-icon", get, { ours: (status) => status === 500 });

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
