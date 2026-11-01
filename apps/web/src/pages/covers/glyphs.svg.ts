import { glyphSheet } from "@singularity/cover";
import type { APIRoute } from "astro";
import { loadCoverFonts } from "../../lib/coverFonts";

/** The outlines every live cover letters itself with (D311): one cached file, never one per cover. */
export const GET: APIRoute = () => {
  loadCoverFonts();
  return new Response(glyphSheet(), { headers: { "Content-Type": "image/svg+xml" } });
};
