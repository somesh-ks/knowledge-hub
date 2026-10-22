import { describe, expect, it } from "vitest";
import type { SqlClient } from "./configPaths.js";
import { takeSharedSlot } from "./rateCounter.js";

/** A counter that keeps one count per bucket and window, as the upsert does for the newest window. */
function fakeCounter(): SqlClient {
  const counts = new Map<string, number>();
  return {
    query: async (_text, params = []) => {
      const key = `${String(params[0])}@${String(params[1])}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return [{ count }];
    },
  };
}

describe("takeSharedSlot", () => {
  // The bug: the caps of the open paid routes were counted per instance, so each cold start handed
  // out a fresh minute. The shared count must hold a full minute closed, refusals included, and
  // open again only in the next minute, for every bucket on its own.
  it("allows the cap in a minute, refuses the rest of that minute, and opens again in the next", async () => {
    const sql = fakeCounter();
    const minute = 29_000_000 * 60_000;
    const take = (bucket: string, at: number) => takeSharedSlot(sql, bucket, 2, at);

    expect(await take("a", minute)).toBe(true);
    expect(await take("a", minute + 30_000)).toBe(true);
    expect(await take("a", minute + 59_999)).toBe(false);
    expect(await take("b", minute + 59_999)).toBe(true);
    expect(await take("a", minute + 60_000)).toBe(true);
  });
});
