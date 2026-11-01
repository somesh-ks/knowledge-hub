import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EPISODE_INDEX_KEY,
  type Episode,
  episodeRelPath,
  serializeEpisodeFile,
} from "@singularity/core";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { describe, expect, it } from "vitest";
import type { ConditionalBlobClient } from "./blob.js";
import { applyContentDelta } from "./contentDelta.js";
import { pullContent } from "./contentPull.js";
import { CONTENT_MANIFEST_KEY, sha256 } from "./contentSync.js";

const BASE = "https://store.public.blob.example";
const NOW = new Date("2026-11-01T12:00:00Z");

/** An in-memory Blob store with ETags, and a hook that runs before a manifest write. */
function fakeBlob(beforeManifestWrite?: () => void) {
  const objects = new Map<string, { text: string; etag: number }>();
  let etag = 0;
  const client: ConditionalBlobClient = {
    async put(pathname, body, options) {
      if (pathname === CONTENT_MANIFEST_KEY) beforeManifestWrite?.();
      const current = objects.get(pathname);
      if (options.ifMatch !== undefined && options.ifMatch !== String(current?.etag)) {
        throw new BlobPreconditionFailedError();
      }
      etag += 1;
      objects.set(pathname, { text: new TextDecoder().decode(body), etag });
      return { url: `${BASE}/${pathname}`, pathname };
    },
    async head(pathname) {
      const found = objects.get(pathname);
      return found ? { url: `${BASE}/${pathname}`, etag: String(found.etag) } : null;
    },
    async del(pathnames) {
      for (const name of pathnames) objects.delete(name);
    },
    async list() {
      return { blobs: [], hasMore: false };
    },
  };
  const fetchText = async (url: string): Promise<string | null> =>
    objects.get(new URL(url).pathname.slice(1))?.text ?? null;
  const manifest = (): Record<string, string> =>
    JSON.parse(objects.get(CONTENT_MANIFEST_KEY)?.text ?? '{"files":{}}').files;
  return { client, objects, fetchText, manifest };
}

function episodeFile(id: string, generatedAt: string): [string, string] {
  const episode: Episode = {
    id,
    title: `Episode ${id}`,
    request: {
      topic_ids: ["ai"],
      length_minutes: 5,
      format: "readout",
      window_days: 7,
      tone: "neutral",
    },
    generated_at: generatedAt,
    listen_minutes: 5,
    format: "readout",
    sources: [
      { item_id: "0123456789ab", url: "https://example.com/a", headline: "H", source: "S" },
    ],
    turns: [{ idx: 0, speaker: "a", text: "Hello." }],
    char_count: 6,
    cover: { template: "spring", palette: "dusk", seed: 1 },
  };
  return [episodeRelPath(id), serializeEpisodeFile(episode)];
}

const indexIds = (store: ReturnType<typeof fakeBlob>): string[] =>
  JSON.parse(store.objects.get(EPISODE_INDEX_KEY)?.text ?? '{"episodes":[]}').episodes.map(
    (entry: { id: string }) => entry.id,
  );

async function checkout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "content-delta-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe("applyContentDelta", () => {
  // The bug: `content sync` deletes every stored path the checkout lacks. A job that holds one new
  // digest and syncs would erase the rest of the store; a delta must touch only the paths it names.
  it("adds the named file and leaves every other stored path alone", async () => {
    const store = fakeBlob();
    const first = await checkout({ "Digests/2026/11/a.md": "A" });
    await applyContentDelta({
      client: store.client,
      root: first,
      now: NOW,
      fetchText: store.fetchText,
      put: ["Digests/2026/11/a.md"],
      remove: [],
    });
    const second = await checkout({ "Digests/2026/11/b.md": "B" });
    await applyContentDelta({
      client: store.client,
      root: second,
      now: NOW,
      fetchText: store.fetchText,
      put: ["Digests/2026/11/b.md"],
      remove: [],
    });
    expect(Object.keys(store.manifest()).sort()).toEqual([
      "Digests/2026/11/a.md",
      "Digests/2026/11/b.md",
    ]);
  });

  // The bug: two jobs read the manifest, each adds its file, the later write wins and the earlier
  // file is orphaned. The ETag turns that into a retry on top of the other job's manifest.
  it("keeps both files when another job writes the manifest between the read and the write", async () => {
    let armed = false;
    let interfered = false;
    const store = fakeBlob(() => {
      if (!armed || interfered) return;
      interfered = true;
      // The other job lands its file and manifest first.
      const other = { "Digests/2026/11/other.md": sha256(new TextEncoder().encode("O")) };
      store.objects.set("content/Digests/2026/11/other.md", { text: "O", etag: 900 });
      store.objects.set(CONTENT_MANIFEST_KEY, {
        text: JSON.stringify({ version: 1, updated_at: NOW.toISOString(), files: other }),
        etag: 901,
      });
    });
    const seed = await checkout({ "Digests/2026/11/seed.md": "S" });
    // Seed the store so the manifest exists and has an ETag to lose.
    await store.client.put(
      CONTENT_MANIFEST_KEY,
      new TextEncoder().encode(
        JSON.stringify({ version: 1, updated_at: NOW.toISOString(), files: {} }),
      ),
      { contentType: "application/json", cacheControlMaxAge: 60 },
    );
    armed = true;
    const result = await applyContentDelta({
      client: store.client,
      root: seed,
      now: NOW,
      fetchText: store.fetchText,
      put: ["Digests/2026/11/seed.md"],
      remove: [],
    });
    expect(result.attempts).toBe(2);
    expect(Object.keys(store.manifest()).sort()).toEqual([
      "Digests/2026/11/other.md",
      "Digests/2026/11/seed.md",
    ]);
  });

  // The bug: the index was rebuilt from the job's own checkout. A job that holds only the new episode
  // would publish an index of one and the Library would lose every other episode.
  it("lists every episode the store holds when the job's checkout holds only the new one", async () => {
    const store = fakeBlob();
    const [oldPath, oldText] = episodeFile("ep-20261020-0900", "2026-10-20T09:00:00Z");
    const [newPath, newText] = episodeFile("ep-20261023-1800", "2026-10-23T18:00:00Z");
    const first = await checkout({ [oldPath]: oldText });
    const base = { client: store.client, now: NOW, fetchText: store.fetchText, remove: [] };
    await applyContentDelta({ ...base, root: first, put: [oldPath] });
    const second = await checkout({ [newPath]: newText });
    await applyContentDelta({ ...base, root: second, put: [newPath] });
    expect(indexIds(store)).toEqual(["ep-20261023-1800", "ep-20261020-0900"]);
  });

  // The bug: the manifest was written and the index upload failed; the rerun found every hash
  // unchanged, returned early, and the index stayed behind for good.
  it("rebuilds the episode index on a rerun that changes nothing", async () => {
    const store = fakeBlob();
    const [path, text] = episodeFile("ep-20261023-1800", "2026-10-23T18:00:00Z");
    const root = await checkout({ [path]: text });
    const input = {
      client: store.client,
      root,
      now: NOW,
      fetchText: store.fetchText,
      put: [path],
      remove: [],
    };
    await applyContentDelta(input);
    store.objects.delete(EPISODE_INDEX_KEY);
    const rerun = await applyContentDelta(input);
    expect(rerun.uploaded).toEqual([]);
    expect(indexIds(store)).toEqual(["ep-20261023-1800"]);
  });

  // The bug: job A committed its manifest, job B committed a newer one and published its index, then
  // A published an index built from its older manifest and B's episode vanished from the Library.
  it("redoes the episode index when the manifest moved while it was being written", async () => {
    const store = fakeBlob();
    const [aPath, aText] = episodeFile("ep-20261020-0900", "2026-10-20T09:00:00Z");
    const [bPath, bText] = episodeFile("ep-20261023-1800", "2026-10-23T18:00:00Z");
    let interfered = false;
    const racing: ConditionalBlobClient = {
      ...store.client,
      put: async (pathname, body, options) => {
        const result = await store.client.put(pathname, body, options);
        if (pathname === EPISODE_INDEX_KEY && !interfered) {
          interfered = true;
          // Job B lands its episode and manifest while A's first index is being uploaded.
          store.objects.set(`content/${bPath}`, { text: bText, etag: 960 });
          const files = JSON.parse(store.objects.get(CONTENT_MANIFEST_KEY)?.text ?? "{}").files;
          files[bPath] = sha256(new TextEncoder().encode(bText));
          store.objects.set(CONTENT_MANIFEST_KEY, {
            text: JSON.stringify({ version: 1, updated_at: NOW.toISOString(), files }),
            etag: 961,
          });
        }
        return result;
      },
    };
    await applyContentDelta({
      client: racing,
      root: await checkout({ [aPath]: aText }),
      now: NOW,
      fetchText: store.fetchText,
      put: [aPath],
      remove: [],
    });
    expect(indexIds(store)).toEqual(["ep-20261023-1800", "ep-20261020-0900"]);
  });

  // The bug: an episode the manifest lists but the store lacks was left out of the index, which was
  // then published as if whole; the Library lost the episode with no error.
  it("stops instead of publishing an index that leaves out a listed episode", async () => {
    const store = fakeBlob();
    const [oldPath, oldText] = episodeFile("ep-20261020-0900", "2026-10-20T09:00:00Z");
    const [newPath, newText] = episodeFile("ep-20261023-1800", "2026-10-23T18:00:00Z");
    const base = { client: store.client, now: NOW, fetchText: store.fetchText, remove: [] };
    await applyContentDelta({
      ...base,
      root: await checkout({ [oldPath]: oldText }),
      put: [oldPath],
    });
    store.objects.delete(`content/${oldPath}`);
    await expect(
      applyContentDelta({ ...base, root: await checkout({ [newPath]: newText }), put: [newPath] }),
    ).rejects.toThrow(/has no such file/);
  });

  // The bug: a remove deleted its blob after the manifest write without looking again; a job that
  // had put the same path back in between kept a manifest entry whose blob was gone.
  it("keeps the blob of a path another job put back since the manifest was written", async () => {
    const store = fakeBlob();
    const root = await checkout({ "Digests/2026/11/a.md": "A" });
    const seeded = { client: store.client, now: NOW, fetchText: store.fetchText, remove: [] };
    await applyContentDelta({ ...seeded, root, put: ["Digests/2026/11/a.md"] });
    const hash = sha256(new TextEncoder().encode("A"));
    let restore = false;
    const racing: ConditionalBlobClient = {
      ...store.client,
      put: async (pathname, body, options) => {
        const result = await store.client.put(pathname, body, options);
        if (pathname === CONTENT_MANIFEST_KEY) restore = true;
        return result;
      },
      head: async (pathname) => {
        if (restore && pathname === CONTENT_MANIFEST_KEY) {
          restore = false;
          store.objects.set(CONTENT_MANIFEST_KEY, {
            text: JSON.stringify({
              version: 1,
              updated_at: NOW.toISOString(),
              files: { "Digests/2026/11/a.md": hash },
            }),
            etag: 950,
          });
        }
        return store.client.head(pathname);
      },
    };
    await applyContentDelta({
      ...seeded,
      client: racing,
      root,
      put: [],
      remove: ["Digests/2026/11/a.md"],
    });
    expect(store.objects.has("content/Digests/2026/11/a.md")).toBe(true);
  });

  it("refuses a path outside the content folders before it writes anything", async () => {
    const store = fakeBlob();
    const root = await checkout({ "Digests/2026/11/a.md": "A" });
    await expect(
      applyContentDelta({
        client: store.client,
        root,
        now: NOW,
        fetchText: store.fetchText,
        put: ["Digests/2026/11/a.md", "../.env"],
        remove: [],
      }),
    ).rejects.toThrow(/not a content path/);
    expect(store.objects.size).toBe(0);
  });
});

describe("pullContent", () => {
  // The bug: a pull that trusts the CDN would write a stale or truncated object as a digest, and the
  // next sync would publish it. The manifest's hash is the check; a file that fails it stops the pull.
  it("refuses a file whose bytes do not match the manifest, and never deletes local files", async () => {
    const store = fakeBlob();
    const source = await checkout({ "Digests/2026/11/a.md": "A", "Digests/2026/11/b.md": "B" });
    await applyContentDelta({
      client: store.client,
      root: source,
      now: NOW,
      fetchText: store.fetchText,
      put: ["Digests/2026/11/a.md", "Digests/2026/11/b.md"],
      remove: [],
    });
    store.objects.set("content/Digests/2026/11/b.md", { text: "TRUNCATED", etag: 777 });
    const fetchBytes = async (url: string) => {
      const text = store.objects.get(new URL(url).pathname.slice(1))?.text;
      return text === undefined ? null : new TextEncoder().encode(text);
    };
    const target = await checkout({ "Digests/2026/11/local-only.md": "L" });
    await expect(
      pullContent({
        client: store.client,
        root: target,
        fetchText: store.fetchText,
        fetchBytes,
        only: ["Digests"],
      }),
    ).rejects.toThrow(/does not match its manifest hash/);
    expect(await readFile(join(target, "Digests/2026/11/a.md"), "utf8")).toBe("A");
    expect(await readFile(join(target, "Digests/2026/11/local-only.md"), "utf8")).toBe("L");
  });
});
