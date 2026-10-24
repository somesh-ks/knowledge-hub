import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CONTENT_MANIFEST_KEY, syncContent } from "../src/publish/contentSync.js";
import {
  type FakeBlob,
  makeFakeBlob,
  makeTempRoot,
  type TempRoot,
  writeRepoFile,
} from "./audio-fixtures.js";

/**
 * The content store (D173) is what the site will read instead of its build. The bugs it prevents:
 * a removed briefing left in the store, so the site keeps serving it; every file re-sent on every
 * run; and a sync that fails half way writing a manifest that claims files it never sent, so the
 * next sync skips them for good.
 */

const NOW = new Date("2026-10-24T12:00:00Z");

let temp: TempRoot;
let blob: FakeBlob;

beforeEach(async () => {
  temp = await makeTempRoot();
  blob = makeFakeBlob();
});
afterEach(async () => {
  await temp.cleanup();
});

/** The fake store serves what it holds, as the public URL would. */
const fetchText = async (url: string): Promise<string | null> => {
  const pathname = new URL(url).pathname.slice(1);
  const item = blob.store.get(pathname);
  return item ? new TextDecoder().decode(item.body) : null;
};

const sync = () => syncContent({ client: blob, root: temp.root, now: NOW, fetchText });

it("sends only what changed and deletes what is gone", async () => {
  await writeRepoFile(temp.root, "Digests/2026/10/2026-10-20.md", "one");
  await writeRepoFile(temp.root, "Digests/2026/10/2026-10-22.md", "two");
  await writeRepoFile(temp.root, "state/last-run.json", "{}");
  expect((await sync()).uploaded).toHaveLength(3);

  await writeRepoFile(temp.root, "Digests/2026/10/2026-10-22.md", "two, narrated");
  await rm(join(temp.root, "Digests/2026/10/2026-10-20.md"));
  const second = await sync();

  expect(second.uploaded).toEqual(["Digests/2026/10/2026-10-22.md"]);
  expect(second.deleted).toEqual(["Digests/2026/10/2026-10-20.md"]);
  expect(blob.store.has("content/Digests/2026/10/2026-10-20.md")).toBe(false);
});

it("leaves the old manifest when an upload fails, so the next sync sends the file again", async () => {
  await writeRepoFile(temp.root, "Digests/2026/10/2026-10-20.md", "one");
  await sync();
  await writeRepoFile(temp.root, "Digests/2026/10/2026-10-22.md", "two");

  blob.failNextPuts = 1;
  await expect(sync()).rejects.toThrow();
  expect(blob.store.has(CONTENT_MANIFEST_KEY)).toBe(true);

  expect((await sync()).uploaded).toEqual(["Digests/2026/10/2026-10-22.md"]);
});
