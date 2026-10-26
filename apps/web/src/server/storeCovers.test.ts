import { COVER_MODES } from "@singularity/cover";
import { expect, it } from "vitest";
import { themedCoverSrc } from "../lib/covers";
import { loadSite } from "../lib/site";
import { COVERS_INDEX_KEY, storeCovers } from "./storeCovers";

/**
 * Pages rendered from the content store name briefings and episodes newer than the last deploy,
 * whose covers the build never drew (D173). The bugs this prevents: a cover address a page or the
 * lock screen uses that the store is never given (a blank square on every new briefing), and covers
 * drawn again on every sync, which would spend the store's monthly write allowance.
 */

const BASE = "https://teststore1.public.blob.vercel-storage.com";

it("stores every cover address the pages use, once per id", async () => {
  const full = await loadSite({ env: { SINGULARITY_FIXTURES: "1" }, warn: () => {} });
  const site = { ...full, entries: full.entries.slice(0, 1), episodes: full.episodes.slice(0, 1) };
  const store = new Map<string, Uint8Array>();
  const deps = {
    site,
    base: BASE,
    fetch: async (url: string) => {
      const body = store.get(new URL(url).pathname.slice(1));
      return body
        ? new Response(new TextDecoder().decode(body))
        : new Response(null, { status: 404 });
    },
    put: async (pathname: string, body: Uint8Array) => {
      store.set(pathname, body);
    },
    now: () => 0,
  };

  await storeCovers(deps);

  const covers = [...site.entries, ...site.episodes].map((entry) => ({
    id: entry.id,
    cover: entry.player.cover,
  }));
  expect(covers.length).toBe(2);
  for (const { id, cover } of covers) {
    const bare = (src: string) => src.replace(/\?v=\w+$/, "");
    const addresses = [
      bare(cover.src512),
      bare(cover.src1024),
      // The lock screen and the link card ask for the PNG beside each WebP (mediaSession.ts, linkCard.ts).
      bare(cover.src512).replace(/\.webp$/, ".png"),
      bare(cover.src1024).replace(/\.webp$/, ".png"),
      ...COVER_MODES.flatMap((mode) => [
        themedCoverSrc(id, mode, 512),
        themedCoverSrc(id, mode, 1024),
      ]),
    ];
    for (const address of addresses) expect(store.has(`content${address}`), address).toBe(true);
  }

  // The next sync finds both ids in the index and draws nothing.
  expect(store.has(COVERS_INDEX_KEY)).toBe(true);
  expect(await storeCovers(deps)).toEqual([]);
});

// A regenerated briefing keeps its id, so "drawn once per id" kept its old cover for good.
it("draws a regenerated record's cover again, and adopts an index from before versions without a redraw", async () => {
  const full = await loadSite({ env: { SINGULARITY_FIXTURES: "1" }, warn: () => {} });
  const first = full.entries[0];
  if (!first) throw new Error("fixture site has no briefing");
  const store = new Map<string, Uint8Array>();
  const deps = (generated_at: string) => ({
    site: {
      ...full,
      episodes: [],
      entries: [{ ...first, digest: { ...first.digest, generated_at } }],
    },
    base: BASE,
    fetch: async (url: string) => {
      const body = store.get(new URL(url).pathname.slice(1));
      return body
        ? new Response(new TextDecoder().decode(body))
        : new Response(null, { status: 404 });
    },
    put: async (pathname: string, body: Uint8Array) => {
      store.set(pathname, body);
    },
    now: () => 0,
  });
  // An index written before versions were kept: the id is listed, with no version.
  store.set(
    COVERS_INDEX_KEY,
    new TextEncoder().encode(JSON.stringify({ version: 1, ids: [first.id] })),
  );

  expect(await storeCovers(deps("2026-10-07T05:20:00.000Z"))).toEqual([]);
  expect(await storeCovers(deps("2026-10-08T09:00:00.000Z"))).toEqual([first.id]);
  expect(await storeCovers(deps("2026-10-08T09:00:00.000Z"))).toEqual([]);
});
