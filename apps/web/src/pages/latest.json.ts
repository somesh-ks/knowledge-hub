import type { APIRoute } from "astro";
import { buildLatest } from "../lib/latest";
import { getSite } from "../lib/site";

export const GET: APIRoute = async () => {
  const body = buildLatest(await getSite());
  return new Response(`${JSON.stringify(body)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
