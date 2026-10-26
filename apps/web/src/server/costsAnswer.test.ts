import type { CostRecord, PriceTable } from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CostSources,
  costsAnswer,
  PART_TIMEOUT_MS,
  resetCostsCache,
  serveCosts,
} from "./costsAnswer";

const prices: PriceTable = { version: 1, as_of: "2026-10-21", prices: [] };
const query = { period: "day", by: "provider", days: 30 } as const;
const now = new Date("2026-10-26T10:00:00Z");
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const sources = (over: Partial<CostSources> = {}): CostSources => ({
  prices: async () => prices,
  fallbackPrices: () => prices,
  engine: async () => [] as CostRecord[],
  fallbackEngine: () => [] as CostRecord[],
  site: async () => [] as CostRecord[],
  billed: async () => new Map<string, number>(),
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  resetCostsCache();
});
afterEach(() => vi.useRealTimers());

describe("costsAnswer", () => {
  // The Anthropic call had no timeout and ran after the rest, so a hung call hung the page.
  it("answers within the timeout when an upstream call hangs, and marks that part missing", async () => {
    const answer = costsAnswer(query, sources({ billed: never }), now);
    await vi.advanceTimersByTimeAsync(PART_TIMEOUT_MS);
    const body = (await answer)?.body;
    if (!body) throw new Error("no answer");
    expect(body.billing).toBe("unavailable");
    expect(body.site).toBe("ok");
    expect(body.engine).toBe("ok");
  });

  // A hung price table fell back only when the site read's own timer also fired, so the site read was lost.
  it("keeps the site read when the prices hang", async () => {
    const fallback: PriceTable = { version: 1, as_of: "2026-01-01", prices: [] };
    let priced: PriceTable | null = null;
    const answer = costsAnswer(
      query,
      sources({
        prices: never,
        fallbackPrices: () => fallback,
        site: async (table) => {
          priced = table;
          return [] as CostRecord[];
        },
      }),
      now,
    );
    await vi.advanceTimersByTimeAsync(PART_TIMEOUT_MS);
    expect((await answer)?.body.site).toBe("ok");
    expect(priced).toBe(fallback);
  });
});

describe("serveCosts", () => {
  // The owner's report: the page waited on every upstream call, every visit.
  it("serves the last good answer at once while it refreshes", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const compute = async () => {
      calls += 1;
      if (calls === 2) await new Promise<void>((resolve) => (release = resolve));
      return costsAnswer(query, sources(), now);
    };
    const first = await serveCosts("k", compute, 0);
    expect(first?.body.stale).toBeUndefined();

    const second = await serveCosts("k", compute, 60_000);
    expect(second?.body.stale).toBe(true);
    expect(calls).toBe(2);

    release();
    await vi.advanceTimersByTimeAsync(0);
    const third = await serveCosts("k", compute, 61_000);
    expect(third?.body.stale).toBeUndefined();
  });

  it("does not keep a partial answer to serve later", async () => {
    const partial = () => costsAnswer(query, sources({ site: async () => null }), now);
    await serveCosts("k", partial, 0);
    let calls = 0;
    await serveCosts(
      "k",
      async () => {
        calls += 1;
        return partial();
      },
      60_000,
    );
    expect(calls).toBe(1);
  });
});
