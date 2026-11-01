import type { APIRoute } from "astro";
import { NOT_FOUND_HEADERS } from "../../server/coverRoute";

/**
 * `/covers` itself has no cover. Without this route it matched `[...path]` with no path, and Astro
 * threw PrerenderDynamicEndpointPathCollide before the handler ran: a 500 for every bot that asked
 * for the bare address (2026-11-01). A route of its own answers 404 first.
 */
export const prerender = false;

export const GET: APIRoute = () =>
  new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
