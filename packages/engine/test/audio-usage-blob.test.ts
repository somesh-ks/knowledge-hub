import { BlobError, BlobPreconditionFailedError } from "@vercel/blob";
import { describe, expect, it } from "vitest";
import { blobUsageStore, usageBlobKey } from "../src/audio/usageBlob.js";
import type { BlobPutOptions, ConditionalBlobClient } from "../src/publish/blob.js";

const NOW = new Date("2026-11-02T10:00:00Z");
const KEY = usageBlobKey("2026-11");

/** An in-memory store with ETags, so a write against an old version is refused as Blob refuses it. */
function fakeStore(initial?: string) {
  let text = initial ?? null;
  let version = 1;
  const calls: { ifMatch?: string }[] = [];
  const client: ConditionalBlobClient = {
    async head(pathname) {
      if (pathname !== KEY || text === null) return null;
      return { url: `https://blob.test/${KEY}`, etag: `v${version}` };
    },
    async put(pathname, body, options: BlobPutOptions) {
      calls.push({ ifMatch: options.ifMatch });
      if (options.createOnly && text !== null) {
        throw new BlobError("This blob already exists and allowOverwrite is false");
      }
      if (options.ifMatch !== undefined && options.ifMatch !== `v${version}`) {
        throw new BlobPreconditionFailedError();
      }
      text = new TextDecoder().decode(body);
      version += 1;
      return { url: `https://blob.test/${pathname}`, pathname };
    },
    async del() {},
    async list() {
      return { blobs: [], hasMore: false };
    },
  };
  const get = async () => ({ ok: text !== null, status: 200, text: async () => text ?? "" });
  return {
    client,
    get,
    calls,
    stored: () => JSON.parse(text ?? "null"),
    /** Another writer (the site) changes the document between this one's read and write. */
    replace(next: string) {
      text = next;
      version += 1;
    },
  };
}

const SITE_DOC = JSON.stringify({
  version: 1,
  speechify: { month: "2026-11", characters: 1000 },
  digests: { "2026-11-01": { day: "2026-11-01", characters: 1000, voice: "v1", whole: true } },
});

describe("the shared Speechify count (D339)", () => {
  // The engine and the site narrate against one allowance. The site's document also holds each
  // digest's charge, which the site's daily cap and its re-charge rules read; an engine write that
  // dropped it would charge every digest again.
  it("adds the engine's characters to the site's document and keeps the digests", async () => {
    const store = fakeStore(SITE_DOC);
    const usage = await blobUsageStore(store.client, store.get).add(NOW, 250);
    expect(usage.speechify).toEqual({ month: "2026-11", characters: 1250 });
    expect(store.stored().speechify.characters).toBe(1250);
    expect(store.stored().digests["2026-11-01"].characters).toBe(1000);
  });

  it("starts a month nobody has narrated in at zero", async () => {
    const store = fakeStore();
    const reader = blobUsageStore(store.client, store.get);
    expect((await reader.load(NOW)).speechify.characters).toBe(0);
    await reader.add(NOW, 40);
    expect(store.stored()).toMatchObject({
      speechify: { month: "2026-11", characters: 40 },
      digests: {},
    });
  });

  // Two writers read the same count and both add: without the version check the second write erases
  // the first, and the budget reads below what Speechify billed.
  it("reads again and adds to the newer count when another writer got in first", async () => {
    const store = fakeStore(SITE_DOC);
    const racing: ConditionalBlobClient = {
      ...store.client,
      async put(pathname, body, options) {
        if (store.calls.length === 0) {
          store.replace(SITE_DOC.replace('"characters":1000', '"characters":1600'));
        }
        return store.client.put(pathname, body, options);
      },
    };
    const usage = await blobUsageStore(racing, store.get).add(NOW, 250);
    expect(usage.speechify.characters).toBe(1850);
    expect(store.stored().speechify.characters).toBe(1850);
  });

  // Both writers read "nothing stored" and both write: the second must not overwrite the first's
  // charge, so a first write only creates.
  it("adds to the count another writer created first when both found the month empty", async () => {
    const store = fakeStore();
    const racing: ConditionalBlobClient = {
      ...store.client,
      async put(pathname, body, options) {
        if (store.calls.length === 0) store.replace(SITE_DOC);
        return store.client.put(pathname, body, options);
      },
    };
    const usage = await blobUsageStore(racing, store.get).add(NOW, 250);
    expect(usage.speechify.characters).toBe(1250);
    expect(store.stored().digests["2026-11-01"].characters).toBe(1000);
  });

  // A document that exists but cannot be read must stop narration, not read as an empty month.
  it("refuses to treat an unreadable document as a month with no use", async () => {
    const store = fakeStore("{broken");
    await expect(blobUsageStore(store.client, store.get).load(NOW)).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
