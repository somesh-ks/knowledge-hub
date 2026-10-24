import { beforeEach, expect, it } from "vitest";
import { resetContentRepo } from "./contentRepo";
import {
  contentCostRecords,
  contentDigestIds,
  contentDigests,
  contentEpisodeIds,
  contentEpisodes,
  resetStoredSchedule,
} from "./contentSources";
import { bundledDigestIds } from "./digestSource";

/**
 * Play, Regenerate and Delete read briefings and episodes through the content repository (D173).
 * The bugs this prevents: Play on a briefing newer than the last deploy answering "not found"
 * because the route read only its bundle, an episode written in a later month than its id not
 * found, a deleted briefing still playing from the bundle, and a store outage stopping Play on
 * briefings the build already holds; and Analytics missing the engine's costs since the last
 * deploy, because the cost report read its bundle; and Play narrating in the old voice after a
 * voice change, because the schedule came from the bundle.
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
  resetStoredSchedule();
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

it("reports engine costs the build does not have from the store's ledger", async () => {
  const record = {
    id: "r1",
    at: "2031-01-02T05:00:00Z",
    run_id: "2031-01-02",
    kind: "daily",
    timezone: "Europe/Stockholm",
    user: "owner",
    scope: "shared",
    stage: "write",
    provider: "anthropic",
    product: "claude-sonnet-5-5",
    units: { input_tokens: 10 },
    usd: 0.5,
  };
  const ledger = "state/costs-2031-01.json";
  store.set(`content/${ledger}`, JSON.stringify({ version: 1, records: [record] }));
  const files = { [NEW_DIGEST]: "h", [ledger]: "h" };
  store.set("content/manifest.json", JSON.stringify({ version: 1, updated_at: "y", files }));

  expect((await contentCostRecords(deps())).map((each) => each.id)).toEqual(["r1"]);
});

it("reads the schedule Play narrates with from the settings store, the build's when it fails", async () => {
  const stored = { version: 1, marker: "stored" };
  const withStore = (read: () => Promise<string | null>) => () => ({
    ...deps({ ...ENV, DATABASE_URL: "postgres://test", DISPATCH_CONFIG_STORE: "postgres" })(),
    readStoredSchedule: read,
  });

  expect(
    await contentDigests(withStore(async () => JSON.stringify(stored))).readSchedule?.(),
  ).toEqual(stored);
  resetStoredSchedule();
  const fromBuild = await contentDigests(deps()).readSchedule?.();
  expect(
    await contentDigests(
      withStore(async () => {
        throw new Error("down");
      }),
    ).readSchedule?.(),
  ).toEqual(fromBuild);
});
