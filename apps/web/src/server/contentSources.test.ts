import { beforeEach, expect, it } from "vitest";
import { resetContentRepo } from "./contentRepo";
import {
  contentDigestIds,
  contentDigests,
  contentEpisodeIds,
  contentEpisodes,
} from "./contentSources";
import { bundledDigestIds } from "./digestSource";

/**
 * Play, Regenerate and Delete read briefings and episodes through the content repository (D173).
 * The bugs this prevents: Play on a briefing newer than the last deploy answering "not found"
 * because the route read only its bundle, an episode written in a later month than its id not
 * found, a deleted briefing still playing from the bundle, and a store outage stopping Play on
 * briefings the build already holds.
 */

const ENV = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_teststore1_0123456789abcdef" };
const NEW_DIGEST = "Digests/2031/01/2031-01-02.md";
const NEW_EPISODE = "Podcasts/2031/02/2031-01-30-ep-abc.md";

let store: Map<string, string>;

const deps =
  (env: Record<string, string> = ENV) =>
  () => ({
    env,
    now: () => 0,
    fetch: async (url: string) => {
      const text = store.get(new URL(url).pathname.slice(1));
      return text === undefined ? new Response(null, { status: 404 }) : new Response(text);
    },
  });

beforeEach(() => {
  resetContentRepo();
  store = new Map([
    [`content/${NEW_DIGEST}`, "---\nkind: on-demand\n---\nnew"],
    [`content/${NEW_EPISODE}`, "episode text"],
  ]);
  const files = Object.fromEntries([NEW_DIGEST, NEW_EPISODE].map((path) => [path, "h"]));
  store.set("content/manifest.json", JSON.stringify({ version: 1, updated_at: "x", files }));
});

it("reads briefings and episodes the build does not have from the store", async () => {
  expect(await contentDigests(deps()).readDigest("2031-01-02")).toContain("new");
  expect(await contentDigestIds(deps())).toEqual(["2031-01-02"]);
  expect(await contentEpisodes(deps()).readEpisode("2031-01-30-ep-abc")).toBe("episode text");
  expect(await contentEpisodeIds(deps())).toEqual(["2031-01-30-ep-abc"]);
});

it("answers a briefing the store no longer holds as gone, not from the build", async () => {
  const [built] = bundledDigestIds();
  if (built) expect(await contentDigests(deps()).readDigest(built)).toBeNull();
});

it("falls back to the build's briefings when the store cannot answer", async () => {
  store.set("content/manifest.json", "{ not json");
  expect(await contentDigestIds(deps())).toEqual(bundledDigestIds());
  resetContentRepo();
  expect(await contentDigestIds(deps({}))).toEqual(bundledDigestIds());
});
