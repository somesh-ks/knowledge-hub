import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_PREFIX, syncContent } from "./contentSync.js";
import { checkout, fakeBlob } from "./contentTestKit.js";
import { pullWorkspace, pushWorkspace } from "./contentWorkspace.js";

const NOW = new Date("2026-11-01T12:00:00Z");
const DIGEST = (day: string) => `Digests/2026/11/2026-11-${day}-regular.md`;

type Store = ReturnType<typeof fakeBlob>;

/** Seed the store as a job left it: a checkout pushed whole (nothing was tracked, so all is new). */
async function seed(store: Store, files: Record<string, string>): Promise<void> {
  const root = await checkout({});
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await syncContent({ client: store.client, root, now: NOW, fetchText: store.fetchText });
}

const input = (store: Store, root: string) => ({
  client: store.client,
  root,
  now: NOW,
  fetchText: store.fetchText,
  fetchBytes: async (url: string) => {
    const text = store.objects.get(new URL(url).pathname.slice(1))?.text;
    return text === undefined ? null : new TextEncoder().encode(text);
  },
});

const stored = (store: Store): string[] =>
  Object.keys(store.manifest())
    .filter((path) => path.startsWith("Digests/"))
    .sort();

async function job(store: Store): Promise<string> {
  const root = await checkout({});
  await pullWorkspace(input(store, root));
  return root;
}

async function write(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

describe("pushWorkspace", () => {
  // The bug: `content sync` mirrors a checkout and deletes what the checkout lacks. The audio job
  // and a digest run overlap; the one that finishes second held an older copy of Digests/ and would
  // have erased the digest the other added. A push sends only what its own job changed.
  it("keeps a digest another job added while this job held an older copy", async () => {
    const store = fakeBlob();
    await seed(store, { [DIGEST("01")]: "one" });
    const slow = await job(store);
    const fast = await job(store);
    await write(fast, DIGEST("02"), "two");
    await pushWorkspace(input(store, fast));
    await write(slow, DIGEST("03"), "three");
    await pushWorkspace(input(store, slow));
    expect(stored(store)).toEqual([DIGEST("01"), DIGEST("02"), DIGEST("03")]);
  });

  // The bug: a deleted digest (`run --delete`, a replace) must leave the store, but only that one.
  it("removes a digest this job deleted and no other", async () => {
    const store = fakeBlob();
    await seed(store, { [DIGEST("01")]: "one", [DIGEST("02")]: "two" });
    const root = await job(store);
    await rm(join(root, DIGEST("01")));
    const result = await pushWorkspace(input(store, root));
    expect(result?.removed).toEqual([DIGEST("01")]);
    expect(stored(store)).toEqual([DIGEST("02")]);
    expect(store.objects.has(`${CONTENT_PREFIX}${DIGEST("01")}`)).toBe(false);
  });

  // The bug: a job that never pulled (a laptop, a workflow without the step) holds no digests, so
  // treating its empty Digests/ as "everything was deleted" would empty the store.
  it("does nothing for a checkout that never pulled", async () => {
    const store = fakeBlob();
    await seed(store, { [DIGEST("01")]: "one" });
    const root = await checkout({});
    expect(await pushWorkspace(input(store, root))).toBeNull();
    expect(stored(store)).toEqual([DIGEST("01")]);
  });

  // The bug: a second push in the same job (audio after a narration) must not repeat the first
  // push's puts, which cost a Blob operation each, nor undo a removal.
  it("sends only what changed since the last push of the same job", async () => {
    const store = fakeBlob();
    await seed(store, { [DIGEST("01")]: "one" });
    const root = await job(store);
    await write(root, DIGEST("02"), "two");
    expect((await pushWorkspace(input(store, root)))?.uploaded).toEqual([DIGEST("02")]);
    await write(root, DIGEST("02"), "two, narrated");
    const second = await pushWorkspace(input(store, root));
    expect(second?.uploaded).toEqual([DIGEST("02")]);
    expect(second?.removed).toEqual([]);
    expect((await pushWorkspace(input(store, root)))?.uploaded).toEqual([]);
  });

  // The bug: state/last-run.json is still committed to git and the site reads it from the store.
  // content.yml used to mirror it; with that sync gone the push has to carry it, once it changed.
  it("copies a changed state file the site reads and skips one the store already has", async () => {
    const store = fakeBlob();
    await seed(store, { [DIGEST("01")]: "one", "state/last-run.json": '{"a":1}' });
    const root = await job(store);
    await write(root, "state/last-run.json", '{"a":1}');
    expect((await pushWorkspace(input(store, root)))?.uploaded).toEqual([]);
    await write(root, "state/last-run.json", '{"a":2}');
    expect((await pushWorkspace(input(store, root)))?.uploaded).toEqual(["state/last-run.json"]);
    expect(store.objects.get(`${CONTENT_PREFIX}state/last-run.json`)?.text).toBe('{"a":2}');
  });
});

describe("syncContent", () => {
  // The bug: content.yml is gone, but a person can still run `content sync` from a checkout with no
  // Digests/ (git no longer holds them), and the mirror would delete every digest in the store.
  it("refuses to empty the store of digests", async () => {
    const store = fakeBlob();
    await seed(store, { [DIGEST("01")]: "one" });
    const root = await checkout({});
    await expect(
      syncContent({ client: store.client, root, now: NOW, fetchText: store.fetchText }),
    ).rejects.toThrow(/no digests/);
    expect(stored(store)).toEqual([DIGEST("01")]);
  });
});
