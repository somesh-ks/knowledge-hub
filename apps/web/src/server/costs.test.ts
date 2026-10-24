import type { PriceTable } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { narrationRecords } from "./costs";
import type { NarrationState } from "./narrationState";

const prices: PriceTable = {
  version: 1,
  as_of: "2026-10-21",
  prices: [
    {
      provider: "speechify",
      product: "*",
      units: { characters: { usd: 10, per: 1_000_000 } },
      as_of: "2026-10-21",
      confirmed: false,
    },
  ],
};

describe("narrationRecords", () => {
  it("bills the characters of failed attempts too and skips an entry with nothing narrated", () => {
    const state: NarrationState = {
      version: 1,
      speechify: { month: "2026-10", characters: 130_000 },
      digests: {
        "2026-10-20": { day: "2026-10-20", characters: 100_000, repeats: 30_000 },
        "2026-10-21": { day: "2026-10-21", characters: 0 },
      },
    };
    const records = narrationRecords(state, prices);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      at: "2026-10-20T12:00:00.000Z",
      kind: "narration_on_play",
      scope: "user",
      units: { characters: 130_000 },
      estimated: true,
    });
    expect(records[0]?.usd).toBeCloseTo(1.3, 10);
  });
});
