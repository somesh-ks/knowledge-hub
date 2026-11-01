import type { APIRoute } from "astro";
import { BUILD_ID } from "../lib/buildId";

// The config store's switch as this build sees it (BaseLayout reads the same two variables):
// health compares it with the Actions side, since one switch alone makes every save do nothing.
const store =
  (process.env.SINGULARITY_CONFIG_STORE ?? process.env.DISPATCH_CONFIG_STORE) === "postgres" &&
  (process.env.DATABASE_URL ?? "") !== ""
    ? "postgres"
    : "files";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify({ build: BUILD_ID, config_store: store })}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
