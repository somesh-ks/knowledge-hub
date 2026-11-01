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
    storage: undefined,
    serviceWorker: undefined,
    locks: {
      request: async (_name: string, a: unknown, b?: unknown) =>
        (typeof a === "function" ? a : (b as (lock: object) => unknown))({}),
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

describe("a list the page cannot read cleanly", () => {
  // Bug (review): a corrupt saved list made every save and removal fail for good, with no way to
  // repair it short of wiping the site's data.
  it("lets a removal rewrite a corrupt list", async () => {
    const { written } = stubBrowser("{not json");
    const { removeDownload } = await import("./libraryDownloads");
    await removeDownload("a");
    expect(written).toEqual(["/__downloads.json"]);
  });
});

describe("download", () => {
  // Bug (review): a fetch's timeout covers its body, so a page fetched before a long audio read met
  // an expired signal when it was finally cached, and the whole save failed on a slow link.
  it("reads the page's body before it waits on the audio's", async () => {
    stubBrowser("empty");
    const order: string[] = [];
    const reply = (name: string): Response => {
      const response = new Response(name);
      const blob = response.blob.bind(response);
      response.blob = async () => {
        order.push(name);
        return blob();
      };
      return response;
    };
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith(".mp3")
        ? reply("audio")
        : url.includes("/covers")
          ? new Response(null, { status: 404 })
          : reply("page"),
    );
    const { download } = await import("./libraryDownloads");
    await download({ id: "a", audio: PAYLOAD, page: "https://news.example/d/a" });
    expect(order).toEqual(["page", "audio"]);
  });
});
