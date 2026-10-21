import type { APIRoute } from "astro";
import { BUILD_ID } from "../lib/buildId";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify({ build: BUILD_ID })}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
