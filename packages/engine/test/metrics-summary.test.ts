import { describe, expect, it } from "vitest";
import type { RunMetric } from "../src/metrics/runMetrics.js";
import { summarize } from "../src/metrics/summary.js";
import type { TimingEntry } from "../src/podcast/timings.js";

const run = (n: number, over: Partial<RunMetric> = {}): RunMetric => ({
  run_id: `run-${n}`,
  at: `2026-10-${String(10 + n).padStart(2, "0")}T06:00:00.000Z`,
  digest_id: `2026-10-${String(10 + n).padStart(2, "0")}`,
  kind: "regular",
  mode: "scheduled",
  replace: false,
  outcome: "published",
  stage_ms: { fetch: 17_000, judge: 5_000, write: 70_000, validate: 120_000 },
  total_ms: 210_000,
  funnel: {
    pool: 87,
    written: 8,
    grounding_dropped: 0,
    grounding_pruned: 0,
    validate_dropped: 0,
    refill_written: 0,
    refill_kept: 0,
    aired: 8,
  },
  length: { asked_chars: 5330, aired_chars: 5200, share: 0.98 },
  verified: true,
  model_fallbacks: 0,
  ...over,
});

const verdicts = (readings: ReadonlyArray<{ metric: string; verdict: string }>) =>
  Object.fromEntries(readings.map((r) => [r.metric, r.verdict]));

// Grounding checks the refill's stories too, so its drops are counted against both writings: with
// three dropped of 8 written and 4 refilled, 9 of 12 survived, not 5 of 8 (independent review).
describe("grounding_survival", () => {
  it("counts the refill's stories as checked, and never goes below zero", () => {
    const withRefill = (n: number) =>
      run(n, {
        funnel: {
          pool: 87,
          written: 8,
          grounding_dropped: 3,
          grounding_pruned: 0,
          validate_dropped: 0,
          refill_written: 4,
          refill_kept: 4,
          aired: 8,
        },
      });
    const summary = summarize({ runs: [withRefill(1), withRefill(2), withRefill(3)], timings: [] });
    expect(summary.briefings.readings.find((r) => r.metric === "grounding_survival")?.value).toBe(
      0.75,
    );
    const heavy = (n: number) =>
      run(n, {
        funnel: {
          pool: 87,
          written: 2,
          grounding_dropped: 9,
          grounding_pruned: 0,
          validate_dropped: 0,
          refill_written: 1,
          refill_kept: 0,
          aired: 3,
        },
      });
    const floor = summarize({ runs: [heavy(1), heavy(2), heavy(3)], timings: [] });
    expect(floor.briefings.readings.find((r) => r.metric === "grounding_survival")?.value).toBe(0);
  });
});

// The 2026-10-27 regenerate aired 2,117 of 5,330 characters and nothing said so beyond one log line.
describe("summarize", () => {
  it("judges nothing before three runs say the same", () => {
    const summary = summarize({ runs: [run(1), run(2)], timings: [] });
    expect(Object.values(verdicts(summary.briefings.readings))).toEqual(
      Array(6).fill("unmeasured"),
    );
  });

  it("calls out a briefing that keeps airing short, and a run that keeps failing", () => {
    const short = { asked_chars: 5330, aired_chars: 2117, share: 0.4 };
    const runs = [1, 2, 3, 4].map((n) => run(n, { length: short }));
    const summary = summarize({
      runs: [...runs, run(5, { outcome: "failed", failure: { stage: "validate", reason: "x" } })],
      timings: [],
    });
    const verdict = verdicts(summary.briefings.readings);
    expect(verdict.length_share).toBe("off");
    expect(verdict.failure_rate).toBe("off");
    expect(verdict.generation_ms).toBe("ok");
  });

  it("measures a healthy run as healthy, and reads stage medians from finished runs only", () => {
    const runs = [1, 2, 3].map((n) => run(n));
    const summary = summarize({
      runs: [...runs, run(4, { outcome: "failed", stage_ms: { fetch: 999_000 } })],
      timings: [],
    });
    expect(Object.values(verdicts(summary.briefings.readings))).toContain("ok");
    expect(summary.briefings.stage_ms.fetch).toBe(17_000);
    expect(summary.briefings.stage_ms.validate).toBe(120_000);
  });

  it("judges episodes by their script share and their time", () => {
    const entry = (n: number, share: number, ms: number): TimingEntry => ({
      at: `2026-10-${String(20 + n).padStart(2, "0")}T10:00:00.000Z`,
      run_id: `ep-${n}`,
      format: "discussion",
      length_minutes: 5,
      stages: { select: 3_000, script: ms, publish: 3_000 },
      metrics: {
        stories: 6,
        matched: 400,
        empty_topics: 0,
        budget_chars: 4840,
        script_chars: Math.round(4840 * share),
        share,
        writer_calls: 3,
      },
    });
    const summary = summarize({
      runs: [],
      timings: [entry(1, 0.77, 120_000), entry(2, 0.8, 130_000), entry(3, 0.95, 110_000)],
    });
    expect(verdicts(summary.episodes.readings)).toEqual({
      script_share: "off",
      generation_ms: "ok",
    });
  });
});
