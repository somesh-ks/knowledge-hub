import { describe, expect, it } from "vitest";
import { handleSourceRatings, RATINGS_CDN_CACHE } from "./sourceRatings";

const config = {
  topicsFile: null,
  registry: { sources: [{ id: "busy", name: "Busy", url: "https://busy.example/" }] },
  user: null,
};
const stats = (published: number) =>
  JSON.stringify({ sources: { busy: { fetched: 60, judged: 40, passed: 20, published } } });
const state =
  (files: Record<string, { text: string | null; stored: boolean }>) => async (path: string) =>
    files[path] ?? { text: null, stored: false };

// The Sources pages were built with last week's ratings, and a run commits new stats without a deploy,
// so a source that began to publish stayed "New" until the next code change.
describe("source ratings", () => {
  it("rates a source from the stats the last run committed, and holds the answer at the edge", async () => {
    const answer = await handleSourceRatings({
      config,
      state: state({
        "state/source-stats.json": { text: stats(10), stored: true },
        "state/source-health.json": { text: null, stored: true },
      }),
    });
    expect(answer.status).toBe(200);
    if (!("ratings" in answer.body)) throw new Error("no ratings");
    expect(answer.body.ratings.busy?.score).not.toBeNull();
    expect(answer.body.ratings.busy?.label).not.toBe("New");
    expect(answer.headers?.["Vercel-CDN-Cache-Control"]).toBe(RATINGS_CDN_CACHE);
  });

  it("answers unavailable, and holds nothing, while the store cannot give the stats", async () => {
    const answer = await handleSourceRatings({
      config,
      state: state({ "state/source-health.json": { text: null, stored: true } }),
    });
    expect(answer.status).toBe(503);
    expect(answer.headers?.["Vercel-CDN-Cache-Control"]).toBeUndefined();
    // A store whose manifest lacks the file reads as stored with no text: that is no history either.
    const missing = await handleSourceRatings({
      config,
      state: state({
        "state/source-stats.json": { text: null, stored: true },
        "state/source-health.json": { text: null, stored: true },
      }),
    });
    expect(missing.status).toBe(503);
    expect(missing.headers?.["Vercel-CDN-Cache-Control"]).toBeUndefined();
    // Stats that do not parse would rate every source New: refused too.
    const broken = await handleSourceRatings({
      config,
      state: state({
        "state/source-stats.json": { text: "{not json", stored: true },
        "state/source-health.json": { text: null, stored: true },
      }),
    });
    expect(broken.status).toBe(503);
    expect(broken.headers?.["Vercel-CDN-Cache-Control"]).toBeUndefined();
    const wrongShape = await handleSourceRatings({
      config,
      state: state({
        "state/source-stats.json": { text: '{"sources":[]}', stored: true },
        "state/source-health.json": { text: null, stored: true },
      }),
    });
    expect(wrongShape.status).toBe(503);
  });
});
