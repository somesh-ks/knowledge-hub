import system from "@singularity/design-system/tokens/system.json?raw";
import type { APIRoute } from "astro";

// The design system as data for an agent (D236): the file `npm run system` writes, served as it is
// at /design/system.json. Never edited here; the unit test holds it to the code it is built from.
export const GET: APIRoute = () =>
  new Response(system, { headers: { "Content-Type": "application/json; charset=utf-8" } });
