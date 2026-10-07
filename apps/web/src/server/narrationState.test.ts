import { describe, expect, it } from "vitest";
import {
  emptyState,
  type NarrationState,
  parseState,
  planCharge,
  secondsUntilNextDay,
  serializeState,
  usageKey,
} from "./narrationState";

/** 14:00 on Wednesday 7 October in Stockholm. */
const NOW = Date.parse("2026-10-07T12:00:00Z");
const MONTH = "2026-10";
const TODAY = "2026-10-07";
const ID = "2026-10-07";

const state = (characters: number, digests: NarrationState["digests"] = {}): NarrationState => ({
  version: 1,
  speechify: { month: MONTH, characters },
  digests,
});

const plan = (
  current: NarrationState,
  characters: number,
  more: { digest?: string; now?: number; monthlyChars?: number; dailyCap?: number } = {},
) =>
  planCharge({
    state: current,
    digest: more.digest ?? ID,
    characters,
    now: more.now ?? NOW,
    monthlyChars: more.monthlyChars ?? 500_000,
    dailyCap: more.dailyCap ?? 3,
  });

describe("the month's document", () => {
  it("lives at one path per month", () => {
    expect(usageKey(MONTH)).toBe("state/usage-2026-10.json");
  });

  it("is an empty month when nothing is stored", () => {
    expect(parseState(null, MONTH)).toEqual(emptyState(MONTH));
    expect(emptyState(MONTH)).toEqual(state(0));
  });

  it("survives being written and read back", () => {
    const written = state(4200, { [ID]: { day: TODAY, characters: 4200 } });
    expect(parseState(serializeState(written), MONTH)).toEqual(written);
  });

  it("reads a document from before digests were recorded as a total with no digests", () => {
    const old = JSON.stringify({ version: 1, speechify: { month: MONTH, characters: 900 } });
    expect(parseState(old, MONTH)).toEqual(state(900));
  });

  it("refuses text it cannot trust, instead of calling it an empty month", () => {
    for (const bad of [
      "",
      "{ not json",
      "null",
      JSON.stringify({ version: 2, speechify: { month: MONTH, characters: 1 } }),
      JSON.stringify({ version: 1, speechify: { month: "2026-09", characters: 1 } }),
      JSON.stringify({ version: 1, speechify: { month: MONTH, characters: "many" } }),
      JSON.stringify({
        version: 1,
        speechify: { month: MONTH, characters: 1 },
        digests: { [ID]: { day: "yesterday", characters: 1 } },
      }),
      JSON.stringify({
        version: 1,
        speechify: { month: MONTH, characters: 1 },
        digests: { [ID]: { day: TODAY, characters: -5 } },
      }),
    ]) {
      expect(() => parseState(bad, MONTH), bad).toThrow("state/usage-2026-10.json");
    }
  });
});

describe("planCharge", () => {
  it("charges a digest its whole text the first time, and records the day", () => {
    expect(plan(state(1000), 3294)).toEqual({
      kind: "charge",
      added: 3294,
      next: state(4294, { [ID]: { day: TODAY, characters: 3294 } }),
    });
  });

  it("charges nothing for a digest that is already charged for as much or more", () => {
    const charged = state(3294, { [ID]: { day: TODAY, characters: 3294 } });
    expect(plan(charged, 3294)).toEqual({ kind: "covered" });
    // An edit that made the text shorter is not refunded, and not charged.
    expect(plan(charged, 3000)).toEqual({ kind: "covered" });
  });

  it("charges an edited digest whose text grew only the difference, and keeps its day", () => {
    const charged = state(5000, { [ID]: { day: "2026-10-03", characters: 3000 } });
    expect(plan(charged, 3294)).toEqual({
      kind: "charge",
      added: 294,
      next: state(5294, { [ID]: { day: "2026-10-03", characters: 3294 } }),
    });
  });

  it("leaves the other digests in the document as they are", () => {
    const others = { "2026-10-01": { day: "2026-10-01", characters: 2000 } };
    const next = plan(state(2000, others), 500);
    expect(next).toMatchObject({
      kind: "charge",
      next: state(2500, { ...others, [ID]: { day: TODAY, characters: 500 } }),
    });
  });

  it("refuses a new digest when the cap's worth were first narrated today", () => {
    const full = state(900, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: TODAY, characters: 300 },
    });
    expect(plan(full, 3294)).toEqual({ kind: "daily_cap", retryAfterSeconds: 10 * 3600 });
    // With room for one more, it goes through.
    expect(plan(full, 3294, { dailyCap: 4 }).kind).toBe("charge");
  });

  it("counts the day a digest was first narrated, not the days it was added to", () => {
    const earlier = state(900, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: "2026-10-06", characters: 300 },
    });
    expect(plan(earlier, 3294).kind).toBe("charge");
  });

  it("does not put the daily cap in the way of a digest that already has its day", () => {
    const full = state(1200, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: TODAY, characters: 300 },
      [ID]: { day: "2026-10-05", characters: 300 },
    });
    expect(plan(full, 500)).toMatchObject({ kind: "charge", added: 200 });
  });

  it("uses the Stockholm day: late evening UTC is already tomorrow there", () => {
    // 22:30 UTC on the 7th is 00:30 on the 8th in Stockholm.
    const lateEvening = Date.parse("2026-10-07T22:30:00Z");
    const full = state(900, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: TODAY, characters: 300 },
    });
    expect(plan(full, 3294, { now: lateEvening })).toMatchObject({
      kind: "charge",
      next: { digests: { [ID]: { day: "2026-10-08" } } },
    });
  });

  it("refuses when the month's budget has no room for all of what is owed", () => {
    // 90 percent of 10,000 is 9,000.
    expect(plan(state(6000), 3000, { monthlyChars: 10_000 }).kind).toBe("charge");
    const refused = plan(state(6001), 3000, { monthlyChars: 10_000 });
    expect(refused).toMatchObject({
      kind: "monthly_budget",
      refusal: { used: 6001, requested: 3000, limit: 9000 },
    });
  });

  it("checks the budget against the difference for a digest that grew", () => {
    const charged = state(8900, { [ID]: { day: TODAY, characters: 3000 } });
    expect(plan(charged, 3100, { monthlyChars: 10_000 })).toMatchObject({
      kind: "charge",
      added: 100,
    });
    expect(plan(charged, 3101, { monthlyChars: 10_000 }).kind).toBe("monthly_budget");
  });

  it("checks the daily cap before the budget, so a full day says so", () => {
    const full = state(8999, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: TODAY, characters: 300 },
    });
    expect(plan(full, 3000, { monthlyChars: 10_000 }).kind).toBe("daily_cap");
  });
});

describe("secondsUntilNextDay", () => {
  it("counts to midnight in Stockholm", () => {
    expect(secondsUntilNextDay(NOW)).toBe(10 * 3600);
    expect(secondsUntilNextDay(Date.parse("2026-10-07T21:59:30Z"))).toBe(30);
    // Winter time: Stockholm is one hour ahead of UTC, not two.
    expect(secondsUntilNextDay(Date.parse("2026-12-01T12:00:00Z"))).toBe(11 * 3600);
  });

  it("is a whole day at midnight exactly, never zero", () => {
    expect(secondsUntilNextDay(Date.parse("2026-10-07T22:00:00Z"))).toBe(24 * 3600);
  });
});
