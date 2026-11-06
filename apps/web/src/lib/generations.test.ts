import { describe, expect, it } from "vitest";
import type { GenerationRow } from "../types/contracts";
import { describeGeneration, type GenerationWords, roundedLeft } from "./generations";

const words: GenerationWords = {
  waiting: "Waiting to start",
  left: "{n} min",
  leftSec: "{n} sec",
  leftHr: "{n} hr",
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

describe("the time left, as a person says it", () => {
  // "4 min 20 sec" read as a clock; the owner asked for the nearest ten seconds, minute or hour.
  it("rounds to ten seconds, a minute or an hour and never mixes units", () => {
    const say = (seconds: number) => roundedLeft(seconds * 1000, words);
    expect([3, 38, 44, 52].map(say)).toEqual(["10 sec", "40 sec", "40 sec", "50 sec"]);
    expect([55, 70, 260, 5399].map(say)).toEqual(["1 min", "1 min", "4 min", "2 hr"]);
  });
});

describe("a row of the podcast queue", () => {
  it("says the stage and the time left, slow past one and a half times the usual, and waiting while queued", () => {
    const estimates = [10_000, 240_000, null, null, null, null];
    const at = (elapsedMs: number) =>
      describeGeneration(row({ stage_estimates_ms: estimates }), {
        now: NOW,
        words,
        followed: { id: 7, stageAt: NOW - elapsedMs },
      });
    // 3 minutes of the script left, plus the usual cover, publishing, voices and wait after it.
    expect(at(60_000)).toMatchObject({ eta: "5 min", status: "Writing the script" });
    // The stage keeps the first line; the slow note is the second and never replaces it.
    expect(at(400_000)).toMatchObject({
      eta: "",
      status: "Writing the script",
      slowNote: "Taking longer than usual",
    });
    expect(at(60_000).slowNote).toBe("");
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

  // Bug it prevents: the engine times its own work in a stage (36 ms to gather, 1 ms for the cover), not
  // the workflow step around it, so every run was "taking longer" within a second of Gathering, and the
  // ring raced through the stages that are only a few milliseconds of that work.
  it("does not call a stage slow for being past what the engine timed, only past the usual step", () => {
    const estimates = [36, 34_000, 1, 14, null, null];
    const at = (stage: number, elapsedMs: number) =>
      describeGeneration(row({ stage, stage_estimates_ms: estimates }), {
        now: NOW,
        words,
        followed: { id: 7, stageAt: NOW - elapsedMs },
      });
    expect(at(0, 14_000).slowNote).toBe("");
    expect(at(2, 9_000).slowNote).toBe("");
    expect(at(1, 90_000).slowNote).toBe("Taking longer than usual");
    // The voices have no usual length of their own, so they are never called slow.
    expect(at(4, 400_000).slowNote).toBe("");
  });

  it("counts further along in a later stage, and never 100 while it is going", () => {
    const at = (stage: number) => describeGeneration(row({ stage }), { now: NOW, words }).percent;
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(99)).toBeLessThanOrEqual(99);
  });

  // The voices are billed as they are made and the usage ledger is written when they end, so a stop
  // there leaves a charge the app never records (D208's known gap). The wait for the site has ended
  // the run, so there is nothing to stop either.
  it("offers Cancel until the voices are being recorded, and not in the wait for the site", () => {
    const cancellable = (over: Partial<GenerationRow>) =>
      describeGeneration(row(over), { now: NOW, words }).cancellable;
    expect(cancellable({ stage: 0 })).toBe(true);
    expect(cancellable({ stage: 3, label: "Publishing" })).toBe(true);
    expect(cancellable({ stage: 4, label: "Recording voices" })).toBe(false);
    expect(cancellable({ stage: 5, label: "Adding it to your Library" })).toBe(false);
    // A run with unnamed steps cannot say when its voices start, so it waits out "Making the episode".
    expect(cancellable({ stages: 3, stage: 0, label: "Getting ready" })).toBe(true);
    expect(cancellable({ stages: 3, stage: 1, label: "Making the episode" })).toBe(false);
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

  // D366: a new take is written live like a Catch up, so it can be heard as it is written too.
  it("offers Listen now for an episode with a live copy, a new take too, and lets through a plain hex tint only", () => {
    const live = (tint: string | null) => ({ runId: 7, title: null, tint });
    expect(describeGeneration(row(), { now: NOW, words, live: live("#a1b2c3") })).toMatchObject({
      listen: true,
      tint: "#a1b2c3",
    });
    expect(
      describeGeneration(row({ kind: "regenerate" }), { now: NOW, words, live: live(null) }).listen,
    ).toBe(true);
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
