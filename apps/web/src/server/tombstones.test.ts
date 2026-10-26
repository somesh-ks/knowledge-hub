import { expect, it } from "vitest";
import type { NarrateBlobStore } from "./blobStore";
import { addTombstone, readTombstones, TOMBSTONES_PATH } from "./tombstones";

/**
 * The bug this prevents: a delete that only reaches the store minutes later, so another device
 * keeps showing the episode. A delete is written at once and survives the next delete (a second
 * write must not drop the first id).
 */
it("keeps earlier deletes when another is written, and readers see them all", async () => {
  const files = new Map<string, string>();
  const store = {
    head: async (path: string) =>
      files.has(path)
        ? {
            pathname: path,
            url: `https://s.test/${path}`,
            uploadedAt: 0,
            size: 0,
            version: "1",
            etag: null,
          }
        : null,
    fetchText: async (url: string) => files.get(new URL(url).pathname.slice(1)) ?? null,
    put: async (path: string, body: string) => {
      files.set(path, body);
      return { url: "" };
    },
  } as unknown as NarrateBlobStore;

  await addTombstone(store, "ep-20261025-1746", 1_000);
  await addTombstone(store, "ep-20261024-0900", 2_000);

  const read = await readTombstones(
    "https://s.test",
    async (url) => {
      const text = files.get(new URL(url).pathname.slice(1));
      return text === undefined ? new Response(null, { status: 404 }) : new Response(text);
    },
    3_000,
  );
  expect([...read].sort()).toEqual(["ep-20261024-0900", "ep-20261025-1746"]);
  expect(files.has(TOMBSTONES_PATH)).toBe(true);
});
