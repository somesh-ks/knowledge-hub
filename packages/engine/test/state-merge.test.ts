import { describe, expect, it } from "vitest";
import { stateMergerFor } from "../src/git/stateMerge.js";

const json = (value: unknown): string => JSON.stringify(value);
const run = (run_id: string, at: string) => ({
  at,
  run_id,
  format: "readout",
  stages: { script: 1 },
});

describe("state merges after a rebase conflict", () => {
  it("keeps one timing entry per run, oldest first, from both sides", () => {
    const merge = stateMergerFor("state/podcast-timings.json");
    const text = merge?.({
      base: null,
      upstream: json({
        version: 1,
        runs: [run("a", "2026-10-27T10:00:00Z"), run("c", "2026-10-27T12:00:00Z")],
      }),
      mine: json({
        version: 1,
        runs: [run("a", "2026-10-27T10:00:00Z"), run("b", "2026-10-27T11:00:00Z")],
      }),
    });
    const runs = (JSON.parse(text ?? "{}") as { runs: { run_id: string }[] }).runs;
    expect(runs.map((r) => r.run_id)).toEqual(["a", "b", "c"]);
  });

  it("takes the newer month's Speechify count when the month rolled over on one side", () => {
    const usage = (month: string, characters: number): string =>
      json({ version: 1, speechify: { month, characters } });
    const text = stateMergerFor("state/usage.json")?.({
      base: usage("2026-09", 400),
      upstream: usage("2026-09", 450),
      mine: usage("2026-10", 20),
    });
    expect(JSON.parse(text ?? "{}").speechify).toEqual({ month: "2026-10", characters: 20 });
  });

  it("keeps both runs' metrics, one per run and digest", () => {
    const metric = (run_id: string, at: string): Record<string, unknown> => ({
      run_id,
      at,
      digest_id: "2026-10-27",
      kind: "regular",
      mode: "on-demand",
      replace: true,
      outcome: "published",
      stage_ms: {},
      funnel: {
        pool: 1,
        written: 1,
        grounding_dropped: 0,
        grounding_pruned: 0,
        validate_dropped: 0,
        refill_written: 0,
        refill_kept: 0,
        aired: 1,
      },
      length: { asked_chars: null, aired_chars: null, share: null },
      verified: true,
      model_fallbacks: 0,
    });
    const text = stateMergerFor("state/run-metrics.json")?.({
      base: null,
      upstream: json({ version: 1, runs: [metric("a", "2026-10-27T10:00:00.000Z")] }),
      mine: json({ version: 1, runs: [metric("b", "2026-10-27T11:00:00.000Z")] }),
    });
    expect(
      (JSON.parse(text ?? "{}") as { runs: { run_id: string }[] }).runs.map((r) => r.run_id),
    ).toEqual(["a", "b"]);
  });

  // One entry the schema no longer reads must not turn a mergeable conflict into a failed push.
  it("leaves out a metrics entry that does not parse and keeps the rest", () => {
    const good = (run_id: string): Record<string, unknown> => ({
      run_id,
      at: "2026-10-27T10:00:00.000Z",
      digest_id: "2026-10-27",
      kind: "regular",
      mode: "scheduled",
      replace: false,
      outcome: "published",
      stage_ms: {},
      funnel: {
        pool: 1,
        written: 1,
        grounding_dropped: 0,
        grounding_pruned: 0,
        validate_dropped: 0,
        refill_written: 0,
        refill_kept: 0,
        aired: 1,
      },
      length: { asked_chars: null, aired_chars: null, share: null },
      verified: true,
      model_fallbacks: 0,
    });
    const text = stateMergerFor("state/run-metrics.json")?.({
      base: null,
      upstream: json({ version: 1, runs: [good("a"), { run_id: "old-shape" }] }),
      mine: json({ version: 1, runs: [good("b")] }),
    });
    expect(
      (JSON.parse(text ?? "{}") as { runs: { run_id: string }[] }).runs.map((r) => r.run_id),
    ).toEqual(["a", "b"]);
  });

  it("declines a file it cannot read, so the conflict stands", () => {
    const text = stateMergerFor("state/costs-2026-10.json")?.({
      base: null,
      upstream: "<<<<<<< not json",
      mine: json({ version: 1, records: [] }),
    });
    expect(text).toBeNull();
  });

  it("has no merger for a file whose entries depend on each other", () => {
    expect(stateMergerFor("state/seen.json")).toBeUndefined();
  });
});
