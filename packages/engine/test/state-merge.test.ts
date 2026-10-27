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
