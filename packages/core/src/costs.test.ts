import { describe, expect, it } from "vitest";
import {
  buildReport,
  type CostRecord,
  costPerUser,
  mergeRecords,
  type PriceTable,
  priceUnits,
} from "./costs.js";

const prices: PriceTable = {
  version: 1,
  as_of: "2026-10-21",
  prices: [
    {
      provider: "anthropic",
      product: "*",
      units: {
        input_tokens: { usd: 3, per: 1_000_000 },
        output_tokens: { usd: 15, per: 1_000_000 },
      },
      as_of: "2026-10-21",
      confirmed: true,
    },
    {
      provider: "speechify",
      product: "simba",
      units: { characters: { usd: 10, per: 1_000_000 } },
      as_of: "2026-10-21",
      confirmed: true,
    },
  ],
};

let n = 0;
const record = (over: Partial<CostRecord>): CostRecord => ({
  id: `r${++n}`,
  at: "2026-10-20T05:00:00Z",
  run_id: "run-a",
  kind: "daily",
  timezone: "Europe/Stockholm",
  user: "owner",
  scope: "shared",
  stage: "write",
  provider: "anthropic",
  product: "m",
  units: {},
  usd: 1,
  ...over,
});

describe("priceUnits", () => {
  it("bills input and output tokens at their own rates, not one blended rate", () => {
    const { usd } = priceUnits(prices, "anthropic", "any-model", {
      input_tokens: 2_000_000,
      output_tokens: 100_000,
    });
    expect(usd).toBeCloseTo(6 + 1.5, 10);
  });

  it("flags a unit with no price instead of silently counting it as free", () => {
    const priced = priceUnits(prices, "speechify", "simba", { characters: 1000, requests: 3 });
    expect(priced.usd).toBeCloseTo(0.01, 10);
    expect(priced.unpriced).toBe(true);
    expect(priceUnits(prices, "unknown", "x", { requests: 1 }).unpriced).toBe(true);
  });
});

describe("buildReport", () => {
  it("counts a record by the edition's local day across the spring DST change", () => {
    // Stockholm leaves CET at 01:00 UTC on 2026-03-29: 23:30Z on the 28th is already the 29th.
    const records = [
      record({ at: "2026-03-28T22:30:00Z" }),
      record({ at: "2026-03-28T23:30:00Z" }),
    ];
    const report = buildReport(records, { period: "day", timeZone: "Europe/Stockholm" });
    expect(report.buckets.map((b) => b.bucket)).toEqual(["2026-03-28", "2026-03-29"]);
  });

  it("keeps the 25-hour autumn day in one bucket and starts the next at local midnight", () => {
    // 2026-10-25 in Stockholm runs 22:00Z on the 24th to 23:00Z on the 25th.
    const records = [
      record({ at: "2026-10-24T21:59:00Z" }),
      record({ at: "2026-10-24T22:00:00Z" }),
      record({ at: "2026-10-25T22:59:00Z" }),
      record({ at: "2026-10-25T23:00:00Z" }),
    ];
    const report = buildReport(records, { period: "day", timeZone: "Europe/Stockholm" });
    expect(report.buckets.map((b) => [b.bucket, b.total.records])).toEqual([
      ["2026-10-24", 1],
      ["2026-10-25", 2],
      ["2026-10-26", 1],
    ]);
  });

  it("groups weeks from Monday and months by local month", () => {
    const records = [
      record({ at: "2026-10-18T10:00:00Z" }), // Sunday
      record({ at: "2026-10-19T10:00:00Z" }), // Monday
      record({ at: "2026-10-31T23:30:00Z" }), // already November in Stockholm
    ];
    const weeks = buildReport(records, { period: "week", timeZone: "Europe/Stockholm" });
    expect(weeks.buckets.map((b) => b.bucket)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    const months = buildReport(records, { period: "month", timeZone: "Europe/Stockholm" });
    expect(months.buckets.map((b) => b.bucket)).toEqual(["2026-10", "2026-11"]);
  });

  it("filters a custom range by local date, inclusive on both ends", () => {
    const records = [
      record({ at: "2026-10-19T10:00:00Z" }),
      record({ at: "2026-10-20T10:00:00Z" }),
      record({ at: "2026-10-21T10:00:00Z" }),
    ];
    const report = buildReport(records, {
      period: "day",
      timeZone: "UTC",
      from: "2026-10-20",
      to: "2026-10-21",
    });
    expect(report.total.records).toBe(2);
  });

  it("averages per distinct run and per distinct user, not per record", () => {
    const records = [
      record({ run_id: "a", usd: 1 }),
      record({ run_id: "a", usd: 1, provider: "exa" }),
      record({ run_id: "b", usd: 2, user: "u2", scope: "user" }),
    ];
    const report = buildReport(records, { period: "month", groupBy: "provider" });
    expect(report.per_run_usd).toBeCloseTo(2, 10);
    expect(report.per_user_usd).toBeCloseTo(2, 10);
    expect(report.buckets[0]?.groups.exa?.usd).toBe(1);
    expect(report.total.shared_usd).toBe(2);
  });
});

describe("costPerUser", () => {
  it("splits a timezone's shared edition across its users and adds each user's own episodes", () => {
    const records = [
      record({ usd: 6, timezone: "Europe/Stockholm" }),
      record({ usd: 4, timezone: "Asia/Tokyo" }),
      record({ usd: 0.5, scope: "user", user: "ana", kind: "on_demand" }),
    ];
    const { users, unallocated_usd } = costPerUser(records, [
      { id: "ana", timezone: "Europe/Stockholm" },
      { id: "ben", timezone: "Europe/Stockholm" },
      { id: "cho", timezone: "Asia/Tokyo" },
    ]);
    expect(users.ana).toEqual({ own_usd: 0.5, shared_usd: 3, total_usd: 3.5 });
    expect(users.ben?.total_usd).toBe(3);
    expect(users.cho?.total_usd).toBe(4);
    expect(unallocated_usd).toBe(0);
  });

  it("reports shared cost of a zone nobody lives in instead of dropping it", () => {
    const { unallocated_usd } = costPerUser(
      [record({ usd: 2, timezone: "America/Lima" })],
      [{ id: "owner", timezone: "Europe/Stockholm" }],
    );
    expect(unallocated_usd).toBe(2);
  });
});

describe("mergeRecords", () => {
  it("keeps one record when the same run is recorded twice, the later value winning", () => {
    const first = record({ id: "same", usd: 1 });
    const merged = mergeRecords([first], [{ ...first, usd: 3 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.usd).toBe(3);
  });
});
