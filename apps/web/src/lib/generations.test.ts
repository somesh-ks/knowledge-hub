import { describe, expect, it } from "vitest";
import type { GenerationRow } from "../types/contracts";
import { describeGeneration, type GenerationWords } from "./generations";

const words: GenerationWords = {
  waiting: "Waiting to start",
  left: "{n} min left",
  slow: "Taking longer than usual",
};

// A Catch up in the workflow's named steps: five, then the wait for the site.
const row = (over: Partial<GenerationRow> = {}): GenerationRow => ({
  run_id: 7,
  what: "episode",
  kind: "catch_up",
  target: null,
  state: "running",
  started_at: "2026-10-28T09:00:00Z",
  stage: 1,
  stages: 6,
  label: "Writing the script",
  ...over,
});

const NOW = Date.parse("2026-10-28T09:02:00Z");

describe("a row of the podcast queue", () => {
  it("says the stage and the time left, slow past one and a half times the usual, and waiting while queued", () => {
    const estimates = [10_000, 240_000, null, null, null, null];
    const at = (elapsedMs: number) =>
      describeGeneration(row({ stage_estimates_ms: estimates }), {
        now: NOW,
        words,
        followed: { id: 7, stageAt: NOW - elapsedMs },
      });
    expect(at(60_000)).toMatchObject({ eta: "3 min left", status: "Writing the script" });
    expect(at(400_000)).toMatchObject({
      eta: "",
      status: "Taking longer than usual · Writing the script",
    });
    expect(describeGeneration(row(), { now: NOW, words })).toMatchObject({
      eta: "",
      status: "Writing the script",
    });
    expect(
      describeGeneration(row({ state: "queued", stage: 0 }), { now: NOW, words }),
    ).toMatchObject({
      eta: "",
      status: "Waiting to start",
      percent: 0,
    });
  });

  it("counts further along in a later stage, and never 100 while it is going", () => {
    const at = (stage: number) => describeGeneration(row({ stage }), { now: NOW, words }).percent;
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(99)).toBeLessThanOrEqual(99);
  });

  // The voices are billed as they are made and the usage ledger is written when they end, so a stop
  // there leaves a charge the app never records (D208's known gap). The wait for the site has ended
  // the run, so there is nothing to stop either.
  it("offers Cancel until the voices are recorded, and not in the wait for the site", () => {
    const cancellable = (over: Partial<GenerationRow>) =>
      describeGeneration(row(over), { now: NOW, words }).cancellable;
    expect(cancellable({ stage: 0 })).toBe(true);
    expect(cancellable({ stage: 3, label: "Publishing" })).toBe(true);
    expect(cancellable({ stage: 4, label: "Recording voices" })).toBe(false);
    expect(cancellable({ stage: 5, label: "Adding it to your Library" })).toBe(false);
    // A briefing's run has no voices step, and ends with its commit.
    expect(
      cancellable({
        what: "briefing",
        kind: "regenerate",
        stage: 4,
        stages: 7,
        label: "Checking the facts",
      }),
    ).toBe(true);
  });

  it("draws the podcast's own cover only for a real digest id", () => {
    const regenerating = (target: string | null, replace?: string) =>
      describeGeneration(row({ what: "briefing", kind: "regenerate", stages: 7, target }), {
        now: NOW,
        words,
        followed: replace ? { id: 7, retry: { body: { replace } } } : undefined,
      }).cover;
    expect(regenerating("2026-10-27")).toBe("/covers/2026-10-27-512.webp");
    // This browser started the run and knows what it replaces; the list may not.
    expect(regenerating(null, "2026-10-27")).toBe("/covers/2026-10-27-512.webp");
    expect(regenerating(null, "../../etc/passwd")).toBeNull();
    expect(regenerating("ep-20261027-1405")).toBeNull();
  });

  it("offers Listen now only for a Catch up with a live copy, and lets through a plain hex tint only", () => {
    const live = (tint: string | null) => ({ runId: 7, title: null, tint });
    expect(describeGeneration(row(), { now: NOW, words, live: live("#a1b2c3") })).toMatchObject({
      listen: true,
      tint: "#a1b2c3",
    });
    expect(
      describeGeneration(row(), { now: NOW, words, live: live("red; background:url(x)") }).tint,
    ).toBeNull();
    expect(describeGeneration(row(), { now: NOW, words }).listen).toBe(false);
    expect(
      describeGeneration(row({ what: "briefing", kind: "regenerate" }), {
        now: NOW,
        words,
        live: live("#a1b2c3"),
      }).listen,
    ).toBe(false);
  });
});
