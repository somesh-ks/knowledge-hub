import { fallbackEmoji, placeEmoji } from "@dispatch/core";
import { createEmojiPicker } from "@dispatch/engine/source-preview";
import type { APIRoute } from "astro";
import { toResponse } from "../../server/http";
import { newLimiter, takeSlot } from "../../server/rateLimit";

export const prerender = false;

// Jev picks the emoji when the server has a key (TYPESAFE_API_KEY on Vercel); when it cannot answer,
// Gemini Flash-Lite does (GEMINI_API_KEY); without either, or when both fail, the name's fixed
// fallback does; a name that holds a place gets its flag with no call. The answer is always one emoji.
const jevKey = process.env.TYPESAFE_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

// The route is open (D41) and each answer is a paid request, so an instance takes a slot of a
// model's per-minute cap before asking it; past a cap the next model, then the free fallback, answers.
const JEV_PER_MINUTE = 20;
const GEMINI_PER_MINUTE = 20;
const jevAsked = newLimiter();
const geminiAsked = newLimiter();
const picker =
  jevKey || geminiKey
    ? createEmojiPicker(
        { jev: jevKey, gemini: geminiKey },
        {
          jev: () => takeSlot(jevAsked, JEV_PER_MINUTE, Date.now()),
          backup: () => takeSlot(geminiAsked, GEMINI_PER_MINUTE, Date.now()),
        },
      )
    : null;

export const GET: APIRoute = async ({ url }) => {
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60);
  if (name === "") return toResponse({ status: 400, body: { error: "name_required" } });
  const description = (url.searchParams.get("description") ?? "").slice(0, 400);
  const emoji =
    picker && !placeEmoji(name) ? await picker.pick({ name, description }) : fallbackEmoji(name);
  return toResponse({ status: 200, body: { emoji } });
};

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
