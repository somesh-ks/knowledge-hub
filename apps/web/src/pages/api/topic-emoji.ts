import { fallbackEmoji, placeEmoji } from "@singularity/core";
import { createEmojiPicker } from "@singularity/engine/source-preview";
import type { APIRoute } from "astro";
import { recordingFaults, toResponse } from "../../server/http";
import { sharedLimit } from "../../server/rateLimit";

export const prerender = false;

// Jev picks the emoji when the server has a key (TYPESAFE_API_KEY on Vercel); when it cannot answer,
// Gemini Flash-Lite does (GEMINI_API_KEY); without either, or when both fail, the name's fixed
// fallback does; a name that holds a place gets its flag with no call. The answer is always one emoji.
const jevKey = process.env.TYPESAFE_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

// The route is open (D160) and an answer costs up to two paid requests (Jev, then Gemini), so a
// request that would ask a model takes one slot of a per-minute cap shared by every instance; past
// it the free fallback answers.
const ASKS_PER_MINUTE = 20;
const picker = jevKey || geminiKey ? createEmojiPicker({ jev: jevKey, gemini: geminiKey }) : null;

const get: APIRoute = async ({ url }) => {
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60);
  if (name === "") return toResponse({ status: 400, body: { error: "name_required" } });
  const description = (url.searchParams.get("description") ?? "").slice(0, 400);
  const asks = picker !== null && !placeEmoji(name);
  const emoji =
    asks && (await sharedLimit("topic-emoji", ASKS_PER_MINUTE))
      ? await picker.pick({ name, description })
      : fallbackEmoji(name);
  return toResponse({ status: 200, body: { emoji } });
};

export const GET = recordingFaults("api/topic-emoji", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
