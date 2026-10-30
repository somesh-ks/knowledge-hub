import { expect, it } from "vitest";
import { coverSrc } from "../lib/covers";
import { loadSite } from "../lib/site";
import { coverCacheHeaders, findCoverRecord, parseCoverPath } from "./coverRoute";

/**
 * A page rendered from the content store names briefings and episodes newer than the last deploy
 * (D173), and a cover the build never drew is drawn when asked for (D256). The bugs this prevents:
 * a cover address a page or the lock screen uses that nothing answers (a blank square on every new
 * briefing); and a regenerated record kept by the CDN under its new address with the old cover,
 * which would stay for a year.
 */

it("answers every address the pages and the lock screen use for a new briefing and episode", async () => {
  const full = await loadSite({ env: { SINGULARITY_FIXTURES: "1" }, warn: () => {} });
  const site = { ...full, entries: full.entries.slice(0, 1), episodes: full.episodes.slice(0, 1) };
  const ids = [...site.entries, ...site.episodes].map((entry) => entry.id);
  expect(ids.length).toBe(2);

  for (const id of ids) {
    const record = findCoverRecord(site, id);
    expect(record, id).not.toBeNull();
    const paths = [
      `${id}-512.webp`,
      `${id}-1024.webp`,
      // The lock screen and the link card ask for the PNG beside each WebP (mediaSession.ts, linkCard.ts).
      `${id}-512.png`,
      `${id}-1024.png`,
      `light/${id}-512.webp`,
      `dark/${id}-1024.webp`,
    ];
    for (const path of paths) expect(parseCoverPath(path)?.id, path).toBe(id);
  }
  expect(findCoverRecord(site, "2000-01-01")).toBeNull();
});

it("never draws a theme variant as PNG or an address the build never served", () => {
  expect(parseCoverPath("dark/x-512.png")).toBeNull();
  expect(parseCoverPath("sepia/x-512.webp")).toBeNull();
  expect(parseCoverPath("x-300.webp")).toBeNull();
  expect(parseCoverPath("../x-512.webp")).toBeNull();
});

it("keeps a cover for a year only under the address of its record's current version", () => {
  const version = coverSrc("x", 512, "2026-10-30T10:00:00Z").split("?v=")[1] as string;
  const record = { source: {} as never, version: `?v=${version}` };

  expect(coverCacheHeaders(version, record)["Vercel-CDN-Cache-Control"]).toBe("max-age=31536000");
  // The record was regenerated after this address was written, or the page is older than the
  // function's view: the answer is the current cover, kept for a minute only.
  expect(coverCacheHeaders("old", record)["Vercel-CDN-Cache-Control"]).toBe("max-age=60");
  expect(coverCacheHeaders("", record)["Vercel-CDN-Cache-Control"]).toBe("max-age=60");
  expect(coverCacheHeaders("", { ...record, version: "" })["Vercel-CDN-Cache-Control"]).toBe(
    "max-age=60",
  );
});
