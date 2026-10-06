import type { APIRoute } from "astro";
import { readBrandColors } from "../lib/brandColors";
import { buildManifest } from "../lib/manifest";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildManifest(readBrandColors()), null, 2)}\n`, {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
