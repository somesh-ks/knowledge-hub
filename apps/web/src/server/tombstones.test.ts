import { expect, it } from "vitest";
import { createFakeBlobStore } from "../testing/fakeBlobStore";
import { addTombstone, readTombstones, TOMBSTONES_PATH } from "./tombstones";

/**
 * The bug this prevents: a delete that only reaches the store minutes later, so another device
 * keeps showing the episode. A delete is written at once and survives the next delete (a second
 * write must not drop the first id).
 */
it("keeps earlier deletes when another is written, and readers see them all", async () => {
  const store = createFakeBlobStore(() => 0);

  await addTombstone(store, "ep-20261025-1746", 1_000);
  await addTombstone(store, "ep-20261024-0900", 2_000);

  const read = await readTombstones(
    "https://s.test",
    async (url) => {
      const text = await store.fetchText(url);
      return text === null ? new Response(null, { status: 404 }) : new Response(text);
    },
    3_000,
  );
  expect([...read].sort()).toEqual(["ep-20261024-0900", "ep-20261025-1746"]);
  expect(store.has(TOMBSTONES_PATH)).toBe(true);
});
