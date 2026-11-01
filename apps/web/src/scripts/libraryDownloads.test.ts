import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_CACHE } from "../lib/downloads";

const PAYLOAD = "https://news.example/audio/a.mp3";

/** Cache Storage with one downloads cache holding one audio file; reading its list may fail. */
function stubBrowser(manifest: "fails" | "empty") {
  const deleted: string[] = [];
  const cache = {
    match: vi.fn(async () => {
      if (manifest === "fails") throw new Error("storage unavailable");
      return undefined;
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
  return deleted;
}

afterEach(() => vi.unstubAllGlobals());

describe("sweepUnlisted", () => {
  // Bug: a list that could not be read counted as an empty one, so the sweep deleted every saved
  // download as "unlisted".
  it("deletes nothing when the saved list cannot be read", async () => {
    const deleted = stubBrowser("fails");
    const { sweepUnlisted } = await import("./libraryDownloads");
    expect(await sweepUnlisted()).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("still removes a file no saved download names", async () => {
    const deleted = stubBrowser("empty");
    const { sweepUnlisted } = await import("./libraryDownloads");
    expect(await sweepUnlisted()).toBe(1);
    expect(deleted).toEqual([PAYLOAD]);
  });
});
