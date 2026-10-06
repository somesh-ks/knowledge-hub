import type { APIRoute, GetStaticPaths } from "astro";
import { synthesizeWav } from "../../lib/fixtureAudio";
import { usesFixtures } from "../../lib/site";

// Item length in the fixture timeline (apps/web/scripts/buildFixtures.ts).
const ITEM_SECONDS = 3;
const ITEMS = 12;

/** Exists only in a fixture build. A production build emits no file here. */
export const getStaticPaths = (() =>
  usesFixtures() ? [{ params: { name: "audio" } }] : []) satisfies GetStaticPaths;

export const GET: APIRoute = () => {
  const boundaries = Array.from({ length: ITEMS }, (_, index) => index * ITEM_SECONDS);
  const wav = synthesizeWav({ seconds: ITEMS * ITEM_SECONDS, boundaries });
  return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
};
