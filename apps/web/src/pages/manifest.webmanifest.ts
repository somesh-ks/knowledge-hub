import type { APIRoute } from "astro";
import { buildManifest } from "../lib/manifest";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildManifest(), null, 2)}\n`, {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
