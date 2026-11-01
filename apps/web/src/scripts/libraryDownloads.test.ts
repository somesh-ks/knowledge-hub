import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_CACHE } from "../lib/downloads";

const PAYLOAD = "https://news.example/audio/a.mp3";

/** Cache Storage with one downloads cache holding one audio file; reading its list may fail. */
function stubBrowser(manifest: "fails" | "empty" | string) {
  const deleted: string[] = [];
  const written: string[] = [];
  const cache = {
    put: vi.fn(async (key: string) => {
      written.push(key);
    }),
    match: vi.fn(async () => {
      if (manifest === "fails") throw new Error("storage unavailable");
      return manifest === "empty" ? undefined : new Response(manifest);
    }),
    keys: vi.fn(async () => [{ url: PAYLOAD }]),
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
      return true;
    }),
  };
  vi.stubGlobal("caches", {
    has: async (name: string) => name === AUDIO_CACHE,
    open: async () => cache,
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, _o: unknown, run: (lock: object) => unknown) => run({}),
    },
  });
  vi.stubGlobal("location", { href: "https://news.example/library" });
  return { deleted, written };
}

afterEach(() => vi.unstubAllGlobals());

describe("sweepUnlisted", () => {
  // Bug: a list that could not be read counted as an empty one, so the sweep deleted every saved
  // download as "unlisted".
  it("deletes nothing when the saved list cannot be read", async () => {
    const { deleted } = stubBrowser("fails");
    const { sweepUnlisted } = await import("./libraryDownloads");
    expect(await sweepUnlisted()).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("still removes a file no saved download names", async () => {
    const { deleted } = stubBrowser("empty");
    const { sweepUnlisted } = await import("./libraryDownloads");
    expect(await sweepUnlisted()).toBe(1);
    expect(deleted).toEqual([PAYLOAD]);
  });

  // Bug: a list that parsed to nothing (broken JSON) or lost an entry was swept as if those
  // downloads had never been saved.
  it("deletes nothing when the saved list is malformed or has an entry it cannot read", async () => {
    for (const manifest of ["{not json", '{"a":1}', '[{"id":"x"}]']) {
      const { deleted } = stubBrowser(manifest);
      vi.resetModules();
      const { sweepUnlisted } = await import("./libraryDownloads");
      expect(await sweepUnlisted()).toBe(0);
      expect(deleted).toEqual([]);
    }
  });
});

describe("removeDownload", () => {
  // Bug: a list that could not be read counted as empty, so the next save or removal wrote a list
  // that forgot every other download.
  it("writes nothing when the saved list cannot be read", async () => {
    const { deleted, written } = stubBrowser("fails");
    const { removeDownload } = await import("./libraryDownloads");
    await expect(removeDownload("a")).rejects.toThrow();
    expect(written).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
