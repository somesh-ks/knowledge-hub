import { createCommentReader } from "@singularity/engine/comment-hints";
import type { APIRoute } from "astro";
import { answerWithRef, toResponse } from "../../server/http";
import { sharedLimit } from "../../server/rateLimit";
import { handleRegenHints } from "../../server/regenHints";

export const prerender = false;

// Jev reads a Regenerate comment when the server has a key (TYPESAFE_API_KEY on Vercel); without one
// the sheet's word match stands. A sheet asks once per pause in typing, a few times a Regenerate; past
// this many a minute across instances the word match stands.
const JEV_PER_MINUTE = 20;
const log = (message: string) => console.error(`[api/regen-hints] ${message}`);
const reader = process.env.TYPESAFE_API_KEY
  ? createCommentReader(process.env.TYPESAFE_API_KEY, (reason) => log(`Jev: ${reason}`))
  : null;

// No sign-in (D368), as every app action: the same-origin check and the shared cap bound the spend.
export const POST: APIRoute = ({ request, url }) =>
  answerWithRef("api/regen-hints", async () =>
    handleRegenHints(
      {
        bodyText: (await request.text()).slice(0, 4_000),
        origin: request.headers.get("origin"),
        expectedOrigin: url.origin,
      },
      {
        ...(reader ? { read: (comment, categories) => reader.read(comment, categories) } : {}),
        mayRead: () => sharedLimit("regen-hints:jev", JEV_PER_MINUTE),
      },
    ),
  );

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } });
