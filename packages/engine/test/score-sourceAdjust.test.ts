import { MIN_JUDGED, type SourceStatsFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import {
  SOURCE_ADJUSTMENT_MAX,
  SOURCE_PASS_NEUTRAL,
  sourceAdjustment,
  withSourceAdjustment,
} from "../src/score/sourceAdjust.js";
import type { ScoredItem } from "../src/score/types.js";
import { makeEntry, makeItem } from "./score-factories.js";

function stats(judged: number, passed: number, id = "example-blog"): SourceStatsFile {
  return {
    version: 1,
    sources: {
      [id]: { fetched: judged, judged, passed, published: 0, window_start: "2026-10-01" },
    },
  };
}

function scored(score: number): ScoredItem {
  const item = makeItem({ source_id: "example-blog" });
  return {
    item,
    entry: makeEntry(item),
    score,
    topCategory: "design_engineering_craft",
    breakdown: { taste: score, craftFactor: 1, penaltyFactor: 1, bonus: 0 },
  };
}

describe("source adjustment", () => {
  it("is a nudge smaller than the preference bonus", () => {
    expect(SOURCE_ADJUSTMENT_MAX).toBeLessThan(0.05);
    expect(MIN_JUDGED).toBe(10);
  });

  it("is zero for a source with too little history or no record", () => {
    expect(sourceAdjustment(stats(MIN_JUDGED - 1, 0), "example-blog")).toBe(0);
    expect(sourceAdjustment(stats(40, 0), "other-source")).toBe(0);
    expect(sourceAdjustment(undefined, "example-blog")).toBe(0);
  });

  it("is zero at the neutral pass rate and scales linearly either side", () => {
    expect(sourceAdjustment(stats(40, 40 * SOURCE_PASS_NEUTRAL), "example-blog")).toBe(0);
    expect(sourceAdjustment(stats(40, 0), "example-blog")).toBe(-SOURCE_ADJUSTMENT_MAX);
    expect(sourceAdjustment(stats(40, 5), "example-blog")).toBe(-SOURCE_ADJUSTMENT_MAX / 2);
    expect(sourceAdjustment(stats(40, 15), "example-blog")).toBe(SOURCE_ADJUSTMENT_MAX / 2);
    expect(sourceAdjustment(stats(MIN_JUDGED, MIN_JUDGED), "example-blog")).toBe(
      SOURCE_ADJUSTMENT_MAX,
    );
  });

  it("never exceeds the maximum, even with more passed than judged", () => {
    expect(sourceAdjustment(stats(10, 20), "example-blog")).toBe(SOURCE_ADJUSTMENT_MAX);
  });

  it("adds to the score, records it in the breakdown and stays within 0 and 1", () => {
    const up = withSourceAdjustment(scored(0.5), stats(20, 20));
    expect(up.score).toBe(0.53);
    expect(up.breakdown.source).toBe(SOURCE_ADJUSTMENT_MAX);
    expect(withSourceAdjustment(scored(0.99), stats(20, 20)).score).toBe(1);
    expect(withSourceAdjustment(scored(0.01), stats(20, 0)).score).toBe(0);
  });

  it("leaves an item from an unproven source untouched", () => {
    const item = scored(0.5);
    expect(withSourceAdjustment(item, stats(5, 5))).toBe(item);
  });
});
