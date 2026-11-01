import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
