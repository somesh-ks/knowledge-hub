import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { diskFiles } from "../lib/contentFiles";
import { loadSite } from "../lib/site";
import {
  expireContentManifest,
  isShowingSavedContent,
  loadPageSite,
  loadStoreSite,
  loadStoreSiteChecked,
  MANIFEST_TTL_MS,
  resetContentRepo,
} from "./contentRepo";

/**
 * A page rendered on request reads the content store (D173) through the same readers as the build.
 * The bugs this prevents: the store path parsing the files differently from the build, so a page
 * shows other briefings than the Library; and the manifest read on every request, which would spend
 * the store's monthly read allowance (a blocked store stops narration for 30 days).
 */

const ENV = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_teststore1_0123456789abcdef" };
const FIXTURES = join(__dirname, "..", "fixtures");

let store: Map<string, string>;
let manifestReads: number;
let fileReads: number;

/** The fixture briefings, published to the fake store as `singularity content sync` would. */
async function fillStore(updatedAt: string, leaveOut = ""): Promise<void> {
  const files: Record<string, string> = {};
  for (const path of await diskFiles.list(join(FIXTURES, "digests"))) {
    const repoPath = `Digests/${relative(join(FIXTURES, "digests"), path).split(sep).join("/")}`;
    if (repoPath === leaveOut) continue;
    const text = await readFile(path, "utf8");
    files[repoPath] = createHash("sha256").update(text).digest("hex");
    store.set(`content/${repoPath}`, text);
  }
  for (const path of await diskFiles.list(join(FIXTURES, "podcasts"))) {
    const repoPath = `Podcasts/${relative(join(FIXTURES, "podcasts"), path).split(sep).join("/")}`;
    const text = await readFile(path, "utf8");
    files[repoPath] = createHash("sha256").update(text).digest("hex");
    store.set(`content/${repoPath}`, text);
  }
  store.set("content/manifest.json", JSON.stringify({ version: 1, updated_at: updatedAt, files }));
}

const fakeFetch = async (url: string): Promise<Response> => {
  const { pathname } = new URL(url);
  if (pathname === "/content/manifest.json") manifestReads++;
  else if (pathname.startsWith("/content/")) fileReads++;
  const text = store.get(pathname.slice(1));
  return text === undefined ? new Response(null, { status: 404 }) : new Response(text);
};

beforeEach(() => {
  resetContentRepo();
  store = new Map();
  manifestReads = 0;
  fileReads = 0;
});

it("lists the same briefings from the store as the build does from the checkout", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  const fromStore = await loadStoreSite({ env: ENV, fetch: fakeFetch, now: () => 0 });
  // The build's reader, pointed at the fixtures' copy of Digests/.
  const fixtureSite = await loadSite({
    root: "",
    env: {},
    files: {
      list: async (dir) =>
        (await diskFiles.list(join(FIXTURES, "digests"))).map((path) =>
          join(dir, relative(join(FIXTURES, "digests"), path)),
        ),
      read: (path) => diskFiles.read(join(FIXTURES, "digests", relative("Digests", path))),
    },
  });

  expect(fromStore?.entries.map((entry) => entry.id)).toEqual(
    fixtureSite.entries.map((entry) => entry.id),
  );
  expect(fromStore?.entries.length).toBeGreaterThan(0);
});

// An unreachable store answered 503, an empty page, though the instance had read the content a
// minute before (plan section 20, criterion 9).
it("keeps the last content and says so while the store cannot be reached", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  let now = 0;
  let down = false;
  let failed = 0;
  const deps = {
    env: ENV,
    fetch: async (url: string) => {
      if (down) {
        failed += 1;
        throw new Error("network down");
      }
      return fakeFetch(url);
    },
    now: () => now,
  };
  const before = (await loadStoreSite(deps))?.entries.length ?? 0;
  expect(isShowingSavedContent()).toBe(false);

  down = true;
  now = MANIFEST_TTL_MS + 1;
  // The load itself says it is the saved site; a cover route cannot call a miss final on it (D258).
  const checked = await loadStoreSiteChecked(deps);
  expect(checked?.site.entries.length).toBe(before);
  expect(checked?.saved).toBe(true);
  expect(isShowingSavedContent()).toBe(true);
  // The next request in the window does not wait on the dead store again.
  const attempts = failed;
  await loadStoreSite(deps);
  expect(failed).toBe(attempts);

  down = false;
  now = 2 * MANIFEST_TTL_MS + 2;
  expect((await loadStoreSiteChecked(deps))?.saved).toBe(false);
  expect(isShowingSavedContent()).toBe(false);
});

// Bug: a cold function instance whose Blob store was blocked answered every page 503, so the whole
// site went down on 2026-10-30 although the build held every briefing.
it("draws a cold instance from the build's copy when the store cannot be reached, and says so", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  const built = [...store.keys()].filter((key) => key.startsWith("content/"));
  const bundled = {
    list: async (dir: string) =>
      built.map((k) => k.slice(8)).filter((p) => p.startsWith(`${dir}/`)),
    read: async (path: string) => store.get(`content/${path}`) ?? null,
  };
  const expected = (await loadStoreSite({ env: ENV, fetch: fakeFetch, now: () => 0 }))?.entries
    .length;
  resetContentRepo();
  let now = 0;
  let attempts = 0;
  const deps = {
    env: ENV,
    fetch: async () => {
      attempts += 1;
      throw new Error("store blocked");
    },
    now: () => now,
  };
  const page = await loadPageSite(deps, bundled);
  expect(page.saved).toBe(true);
  expect(page.site.entries.length).toBe(expected);
  expect(isShowingSavedContent()).toBe(true);
  // Requests in the same window do not each wait on the dead store.
  const tried = attempts;
  await loadPageSite(deps, bundled);
  expect(attempts).toBe(tried);

  now = MANIFEST_TTL_MS + 1;
  const recovered = await loadPageSite({ ...deps, fetch: fakeFetch }, bundled);
  expect(recovered.saved).toBe(false);
  expect(isShowingSavedContent()).toBe(false);
});

// Bug: a manifest that loaded while its objects answered 500 gave an empty site, which the page then
// drew as "nothing yet" instead of falling back to this build's copy.
it("draws the build's copy when the manifest loads but its files cannot be read", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  const built = [...store.keys()].filter((key) => key.startsWith("content/"));
  const bundled = {
    list: async (dir: string) =>
      built.map((k) => k.slice(8)).filter((p) => p.startsWith(`${dir}/`)),
    read: async (path: string) => store.get(`content/${path}`) ?? null,
  };
  const expected = (await loadStoreSite({ env: ENV, fetch: fakeFetch, now: () => 0 }))?.entries
    .length;
  resetContentRepo();
  let objectReads = 0;
  const fetchWithBrokenFiles = async (url: string): Promise<Response> => {
    if (new URL(url).pathname === "/content/manifest.json") return fakeFetch(url);
    if (/\/(Digests|Podcasts)\//.test(url)) objectReads += 1;
    return new Response(null, { status: 500 });
  };
  const page = await loadPageSite({ env: ENV, fetch: fetchWithBrokenFiles, now: () => 0 }, bundled);
  expect(page.saved).toBe(true);
  expect(page.site.entries.length).toBe(expected);
  // The store counts as down after its first failed object: slow reads do not pile up.
  expect(objectReads).toBe(1);
});

// Bug (review): a newer manifest whose objects could not be read discarded the last good site, so
// the page fell back to a copy as old as the last deploy.
it("keeps showing the last site it loaded when a newer one cannot be read, and says so", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  let now = 0;
  const deps = { env: ENV, fetch: fakeFetch, now: () => now };
  const first = await loadPageSite(deps, { list: async () => [], read: async () => null });
  expect(first.saved).toBe(false);
  await fillStore("2026-10-24T13:00:00Z");
  now = 2 * MANIFEST_TTL_MS;
  const broken = async (url: string): Promise<Response> =>
    new URL(url).pathname === "/content/manifest.json" || /tombstones/.test(url)
      ? fakeFetch(url)
      : new Response(null, { status: 500 });
  const page = await loadPageSite(
    { ...deps, fetch: broken },
    { list: async () => [], read: async () => null },
  );
  expect(page.saved).toBe(true);
  expect(page.site.entries.length).toBe(first.site.entries.length);
  expect(page.site.entries.length).toBeGreaterThan(0);
});

// Bug (review): a deploy with no store configured read as a degraded outage, with the saved-copy
// notice on every page.
it("serves the build's copy without calling it saved when no store is configured", async () => {
  const bundled = { list: async () => [], read: async () => null };
  const page = await loadPageSite({ env: {}, fetch: fakeFetch, now: () => 0 }, bundled);
  expect(page.saved).toBe(false);
  expect(isShowingSavedContent()).toBe(false);
});

// Bug: requests that reached a cold instance together each waited out the dead store's timeout.
it("makes one store attempt for requests that arrive together during an outage", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  const built = [...store.keys()].filter((key) => key.startsWith("content/"));
  const bundled = {
    list: async (dir: string) =>
      built.map((k) => k.slice(8)).filter((p) => p.startsWith(`${dir}/`)),
    read: async (path: string) => store.get(`content/${path}`) ?? null,
  };
  resetContentRepo();
  let attempts = 0;
  const deps = {
    env: ENV,
    fetch: async () => {
      attempts += 1;
      throw new Error("store blocked");
    },
    now: () => 0,
  };
  await Promise.all([1, 2, 3, 4].map(() => loadPageSite(deps, bundled)));
  expect(attempts).toBe(1);
});

it("reads the manifest once per window and reloads when it changes", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  let now = 0;
  const deps = { env: ENV, fetch: fakeFetch, now: () => now };

  await loadStoreSite(deps);
  now = MANIFEST_TTL_MS - 1;
  await loadStoreSite(deps);
  expect(manifestReads).toBe(1);

  const before = (await loadStoreSite(deps))?.entries.length ?? 0;
  await fillStore("2026-10-24T13:00:00Z", "Digests/2026/10/2026-10-05.md");
  now = MANIFEST_TTL_MS + 1;
  const site = await loadStoreSite(deps);
  expect(manifestReads).toBe(2);
  expect(site?.entries.length).toBe(before - 1);
});

it("reads the manifest again on demand without reloading an unchanged site", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  const deps = { env: ENV, fetch: fakeFetch, now: () => 0 };
  const first = await loadStoreSite(deps);
  const readsBefore = fileReads;

  // A cover asked for before this instance saw its record: one small read, not a full reload.
  expireContentManifest();
  const again = await loadStoreSite(deps);
  expect(manifestReads).toBe(2);
  expect(fileReads).toBe(readsBefore);
  expect(again?.entries.length).toBe(first?.entries.length);

  await fillStore("2026-10-24T13:00:00Z", "Digests/2026/10/2026-10-05.md");
  expireContentManifest();
  const changed = await loadStoreSite(deps);
  expect(changed?.entries.length).toBe((first?.entries.length ?? 0) - 1);
});

it("skips an episode deleted a moment ago, before the sync drops it from the store", async () => {
  await fillStore("2026-10-24T12:00:00Z");
  const before = await loadStoreSite({ env: ENV, fetch: fakeFetch, now: () => 0 });
  const gone = before?.episodes[0]?.id ?? "";
  expect(gone).not.toBe("");
  store.set("tombstones/episodes.json", JSON.stringify([{ id: gone, at: 0 }]));
  resetContentRepo();
  const after = await loadStoreSite({ env: ENV, fetch: fakeFetch, now: () => 0 });
  expect(after?.episodes.map((entry) => entry.id)).not.toContain(gone);
  expect(after?.episodes.length).toBe((before?.episodes.length ?? 0) - 1);
});
