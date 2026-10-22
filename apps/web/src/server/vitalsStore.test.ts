import { describe, expect, it } from "vitest";
import type { BlobEntry, NarrateBlobStore } from "./blobStore";
import { handleReport } from "./report";
import { newVitalsMemo, recordVital, VITALS_DAY_CAP } from "./vitalsStore";

/** An in-memory store that counts the ADVANCED operations (puts) it is asked for. */
function memoryStore() {
  const files = new Map<string, string>();
  let puts = 0;
  const entry = (pathname: string): BlobEntry => ({
    pathname,
    url: `https://store.example/${pathname}`,
    uploadedAt: 0,
    size: 0,
    version: String(files.get(pathname)?.length ?? 0),
    etag: null,
  });
  const store: NarrateBlobStore = {
    head: async (pathname) => (files.has(pathname) ? entry(pathname) : null),
    fetchText: async (url) => files.get(new URL(url).pathname.slice(1)) ?? null,
    put: async (pathname, body) => {
      puts += 1;
      files.set(pathname, String(body));
      return { url: entry(pathname).url };
    },
    create: async () => true,
    del: async () => undefined,
    delIfUnchanged: async () => true,
  };
  return { store, files, puts: () => puts };
}

describe("real-user Web Vitals", () => {
  // A quiet site lost every sample an instance held for a write it never made; and each put spends
  // one of the 2,000 ADVANCED operations a month narration needs, so all instances together stop at
  // the day's cap, read from the file.
  it("stores each sample as it arrives and stops every instance once the day's file is full", async () => {
    const memory = memoryStore();
    const [first, second] = [newVitalsMemo(), newVitalsMemo()];
    const now = Date.parse("2026-10-21T10:00:00Z");
    const deps = { openBlob: () => memory.store, now: () => now, log: () => undefined };
    const stored = () => memory.files.get("health/vitals-2026-10-21.json") ?? "";
    const body = JSON.stringify({ kind: "vitals", page: "/?key=secret-value", lcp: 1800, inp: 90 });

    for (let i = 0; i < 2; i++) {
      await handleReport(
        body,
        {
          log: () => undefined,
          now: () => now,
          vital: (sample) => recordVital(sample, first, deps),
        },
        { windowStart: 0, count: 0 },
      ).work;
    }
    expect(JSON.parse(stored()).samples).toHaveLength(2);
    expect(stored()).not.toContain("secret-value");

    for (let i = 0; i < VITALS_DAY_CAP * 2; i++) {
      await recordVital({ at: now, page: "/", cls: 0.02 }, i % 2 ? first : second, deps);
    }
    expect(JSON.parse(stored()).samples).toHaveLength(VITALS_DAY_CAP);
    expect(memory.puts()).toBe(VITALS_DAY_CAP);
  });

  // A forged beacon must not land in the file and skew the p75 health reads.
  it("refuses a vitals report with no metric or one out of range", () => {
    const deps = { log: () => undefined, now: () => 0, vital: async () => undefined };
    const limiter = { windowStart: 0, count: 0 };
    for (const forged of [{ lcp: 1e9 }, { inp: "fast" }, {}]) {
      expect(
        handleReport(JSON.stringify({ kind: "vitals", ...forged }), deps, limiter).status,
      ).toBe(400);
    }
  });
});
