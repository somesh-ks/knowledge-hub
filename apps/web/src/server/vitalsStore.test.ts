import { VITALS_DAY_MAX_SAMPLES } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import type { BlobEntry, NarrateBlobStore } from "./blobStore";
import { handleReport } from "./report";
import { newVitalsBuffer, recordVital, VITALS_FLUSH_MS } from "./vitalsStore";

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
  // Each put spends one of the store's 2,000 ADVANCED operations a month, which narration needs:
  // a flood of beacons must not write once per beacon, nor grow the day's file without end.
  it("writes a day's samples at most once per window and stops once the file is full", async () => {
    const memory = memoryStore();
    const buffer = newVitalsBuffer();
    let now = Date.parse("2026-10-21T10:00:00Z");
    const deps = { openBlob: () => memory.store, now: () => now, log: () => undefined };
    const vital = (sample: Parameters<typeof recordVital>[0]) => recordVital(sample, buffer, deps);
    const body = JSON.stringify({ kind: "vitals", page: "/?key=secret-value", lcp: 1800, inp: 90 });

    for (let i = 0; i < 50; i++) {
      await handleReport(
        body,
        { log: () => undefined, now: () => now, vital },
        { windowStart: 0, count: 0 },
      ).work;
    }
    expect(memory.puts()).toBe(1);
    now += VITALS_FLUSH_MS;
    await vital({ at: now, page: "/", cls: 0.02 });
    expect(memory.puts()).toBe(2);
    const stored = memory.files.get("health/vitals-2026-10-21.json") ?? "";
    expect(JSON.parse(stored).samples).toHaveLength(51);
    expect(stored).not.toContain("secret-value");

    for (let i = 0; i < VITALS_DAY_MAX_SAMPLES * 2; i++) {
      await vital({ at: now, page: "/", lcp: 1000 });
    }
    now += VITALS_FLUSH_MS;
    await vital({ at: now, page: "/", lcp: 1000 });
    now += VITALS_FLUSH_MS;
    await vital({ at: now, page: "/", lcp: 1000 });
    expect(
      JSON.parse(memory.files.get("health/vitals-2026-10-21.json") ?? "").samples,
    ).toHaveLength(VITALS_DAY_MAX_SAMPLES);
    expect(memory.puts()).toBe(3);
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
