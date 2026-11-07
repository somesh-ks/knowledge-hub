import llms from "@singularity/design-system/tokens/llms.txt?raw";
import type { APIRoute } from "astro";

// The short index of the design system for an agent (D236), served as written at /design/llms.txt.
export const GET: APIRoute = () =>
  new Response(llms, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
