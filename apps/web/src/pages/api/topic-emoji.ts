import { fallbackEmoji } from "@dispatch/core";
import { createEmojiPicker } from "@dispatch/engine/source-preview";
import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";

export const prerender = false;

// Jev picks the emoji when the server has a key (TYPESAFE_API_KEY on Vercel); without one, or when
// it cannot answer, the name's fixed fallback does. The answer is always one emoji.
const picker = process.env.TYPESAFE_API_KEY
  ? createEmojiPicker(process.env.TYPESAFE_API_KEY)
  : null;

export const GET: APIRoute = async ({ url }) => {
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60);
  if (name === "") return toResponse({ status: 400, body: { error: "name_required" } });
  const description = (url.searchParams.get("description") ?? "").slice(0, 400);
  const emoji = picker ? await picker.pick({ name, description }) : fallbackEmoji(name);
  return toResponse({ status: 200, body: { emoji } });
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
