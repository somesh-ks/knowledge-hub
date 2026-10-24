import { describe, expect, it } from "vitest";
import { REPO } from "../testing/fakeGitHub";
import { handleStream, readStreamForEpisode, STREAM_CACHE_CONTROL } from "./liveStream";
import { handleNarrationLookup } from "./narrate";

const BLOB_TOKEN = "vercel_blob_rw_teststore_0123456789abcdefghij";
const BASE = "https://teststore.public.blob.vercel-storage.com";
const ID = "ep-20261013-1200";
const env = {
  GITHUB_DISPATCH_TOKEN: "github_pat_secret_value_123456",
  GITHUB_REPOSITORY: REPO,
  BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
  SPEECHIFY_API_KEY: "speechify-key-for-tests",
};

const doc = (status: string, turns: number) => ({
  id: ID,
  title: "AI",
  status,
  turns: Array.from({ length: turns }, (_, i) => ({ speaker: "a", text: `Turn ${i}.` })),
  voices: { a: null, b: null },
  hosts: null,
  format: "readout",
  stories: [],
  updated_at: "2026-10-13T12:00:00.000Z",
});

/** A store of public objects by path, and the URLs it was asked for. */
function fakeStore(objects: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const path = new URL(url).pathname.slice(1);
    return path in objects
      ? new Response(JSON.stringify(objects[path]), { status: 200 })
      : new Response("", { status: 404 });
  };
  return { fetch, asked };
}

describe("GET /api/stream", () => {
  it("reads one object, named by the run id alone, so it cannot read anything else in the store", async () => {
    const store = fakeStore({ "streams/run-77.json": doc("writing", 3), "audio/secret.mp3": {} });
    const result = await handleStream("77/../../audio/secret.mp3", {
      env,
      fetch: store.fetch,
      now: () => 1,
    });
    expect(result.status).toBe(400);
    expect(store.asked).toEqual([]);
  });

  it("answers the turns written so far, and is never kept by the browser or the CDN", async () => {
    const store = fakeStore({ "streams/run-77.json": doc("writing", 3) });
    const result = await handleStream("77", { env, fetch: store.fetch, now: () => 5 });
    expect(result.status).toBe(200);
    expect(result.headers?.["Cache-Control"]).toBe(STREAM_CACHE_CONTROL);
    expect("turns" in result.body && result.body.turns).toHaveLength(3);
    // The CDN keeps an overwritten object for up to a minute; a new query is a URL it has not kept.
    expect(store.asked[0]).toBe(`${BASE}/streams/run-77.json?t=5`);
  });

  it("says waiting, not an error, before the engine has written anything, and is unavailable without a store", async () => {
    const store = fakeStore({});
    expect((await handleStream("77", { env, fetch: store.fetch, now: () => 1 })).body).toEqual({
      status: "waiting",
      turns: [],
    });
    const { BLOB_READ_WRITE_TOKEN: _token, ...noStore } = env;
    expect(
      (await handleStream("77", { env: noStore, fetch: store.fetch, now: () => 1 })).status,
    ).toBe(503);
    expect((await handleStream("77", { env: {}, fetch: store.fetch, now: () => 1 })).status).toBe(
      503,
    );
  });
});

describe("narrating an episode that is not committed yet", () => {
  const deps = (objects: Record<string, unknown>, committed = false) => {
    const store = fakeStore(objects);
    return {
      env,
      digests: { readDigest: async () => null, readTimeline: async () => null },
      episodes: { readEpisode: async () => (committed ? "not used" : null) },
      liveEpisodes: (id: string) =>
        readStreamForEpisode(id, { env, fetch: store.fetch, now: () => 9 }),
    };
  };
  const lookup = (d: ReturnType<typeof deps>) =>
    handleNarrationLookup({ digest: ID, params: ["digest"] }, d);

  it("lists the turns written so far, one segment each, and is not cached at the edge", async () => {
    const result = await lookup(deps({ [`streams/${ID}.json`]: doc("writing", 4) }));
    expect(result.status).toBe(200);
    expect("segments" in result.body && result.body.segments.map((s) => s.key)).toEqual([
      "t0",
      "t1",
      "t2",
      "t3",
    ]);
    // A cached lookup would hide every turn written after it, and the player would wait for nothing.
    expect(result.headers?.["Cache-Control"]).toBe("private, no-store");
  });

  it("is not found when there is no live copy either", async () => {
    expect((await lookup(deps({}))).status).toBe(404);
  });
});
