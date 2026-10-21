import { fallbackEmoji, placeEmoji } from "@dispatch/core";
import { createEmojiPicker } from "@dispatch/engine/source-preview";
import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";

export const prerender = false;

// Jev picks the emoji when the server has a key (TYPESAFE_API_KEY on Vercel); without one, or when
// it cannot answer, the name's fixed fallback does; a name that holds a place gets its flag with no
// call. The answer is always one emoji.
const picker = process.env.TYPESAFE_API_KEY
  ? createEmojiPicker(process.env.TYPESAFE_API_KEY)
  : null;

// The route is open (D41) and each answer from Jev is a paid request, so an instance asks Jev at most
// this often a minute; past it the fixed fallback answers, which costs nothing.
const JEV_PER_MINUTE = 20;
const asked = { since: 0, count: 0 };
const mayAskJev = (now: number): boolean => {
  if (now - asked.since >= 60_000) Object.assign(asked, { since: now, count: 0 });
  return asked.count++ < JEV_PER_MINUTE;
};

export const GET: APIRoute = async ({ url }) => {
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60);
  if (name === "") return toResponse({ status: 400, body: { error: "name_required" } });
  const description = (url.searchParams.get("description") ?? "").slice(0, 400);
  const emoji =
    picker && !placeEmoji(name) && mayAskJev(Date.now())
      ? await picker.pick({ name, description })
      : fallbackEmoji(name);
  return toResponse({ status: 200, body: { emoji } });
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
