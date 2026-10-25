import { describe, expect, it } from "vitest";
import { GENERATE_STEPS } from "../types/contracts";
import {
  BRIEFING_STAGES,
  BRIEFING_UPDATING_LABEL,
  briefingStage,
  EPISODE_STAGES,
  episodeStage,
  medianEstimates,
  timeLeft,
  UPDATING_LABEL,
  updatingStage,
} from "./runStages";

describe("briefingStage", () => {
  it("gives every workflow step its own stage, in order", () => {
    const indexes = GENERATE_STEPS.map((step) => briefingStage(step).stage);
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("starts at the first stage before any step has started", () => {
    expect(briefingStage(null)).toEqual({
      stage: 0,
      stages: 7,
      label: "Checking the schedule",
    });
  });

  it("leaves the redeploy for the page to show", () => {
    expect(BRIEFING_STAGES.at(-1)).toBe(BRIEFING_UPDATING_LABEL);
    expect(updatingStage("briefing")).toEqual({
      stage: 6,
      stages: 7,
      label: BRIEFING_UPDATING_LABEL,
    });
  });
});

describe("episodeStage", () => {
  const setup = [
    { name: "Set up job", status: "completed" },
    { name: "Install", status: "in_progress" },
    { name: "Podcast", status: "queued" },
  ];

  it("is getting ready until the Podcast step starts", () => {
    expect(episodeStage([])).toMatchObject({ stage: 0, label: "Getting ready" });
    expect(episodeStage(setup)).toMatchObject({ stage: 0, label: "Getting ready" });
  });

  it("is making the episode once the Podcast step runs or has run", () => {
    const running = setup.map((s) => (s.name === "Podcast" ? { ...s, status: "in_progress" } : s));
    expect(episodeStage(running)).toMatchObject({ stage: 1, label: "Making the episode" });
    const done = setup.map((s) => (s.name === "Podcast" ? { ...s, status: "completed" } : s));
    expect(episodeStage(done).stage).toBe(1);
  });

  it("counts the redeploy as the last of three stages", () => {
    expect(EPISODE_STAGES).toHaveLength(3);
    expect(updatingStage("episode")).toEqual({ stage: 2, stages: 3, label: UPDATING_LABEL });
    // A new episode lands in the Library, and the line says so in those words.
    expect(UPDATING_LABEL).toBe("Adding it to your Library");
  });
});

describe("timeLeft", () => {
  const MIN = 60_000;
  const estimates = [1 * MIN, 4 * MIN, 2 * MIN, 1 * MIN];

  it("is the rest of this stage plus the stages after it, in whole minutes, never under one", () => {
    expect(timeLeft(1, estimates, 0)).toEqual({ kind: "left", minutes: 7 });
    expect(timeLeft(1, estimates, 3 * MIN + 30_000)).toEqual({ kind: "left", minutes: 4 });
    expect(timeLeft(3, estimates, 59_000)).toEqual({ kind: "left", minutes: 1 });
  });

  it("says it is slow only past one and a half times the stage estimate", () => {
    expect(timeLeft(1, estimates, 6 * MIN)).toEqual({ kind: "left", minutes: 3 });
    expect(timeLeft(1, estimates, 6 * MIN + 1)).toEqual({ kind: "slow" });
  });

  it("has nothing to say without an estimate for the current stage", () => {
    expect(timeLeft(1, undefined, 0)).toEqual({ kind: "none" });
    expect(timeLeft(5, estimates, 0)).toEqual({ kind: "none" });
    expect(timeLeft(1, [MIN, 0, MIN], 0)).toEqual({ kind: "none" });
  });
});

describe("medianEstimates", () => {
  const run = (format: string, length: number, script: number) => ({
    format,
    length_minutes: length,
    stages: { select: 1000, script, cover: 2000, publish: 500 },
  });

  it("takes the median of the last 10 runs of the same format and length", () => {
    const tens = Array.from({ length: 10 }, (_, i) => run("solo", 5, 1000 * (i + 1)));
    const runs = [run("solo", 5, 99_000), ...tens, run("solo", 10, 1)];
    expect(medianEstimates(runs, "solo", 5)?.[1]).toBe(5500);
  });

  it("falls back to the same format when fewer than 3 match, and leaves voices untimed", () => {
    const runs = [
      run("solo", 5, 100),
      run("solo", 5, 200),
      run("solo", 10, 300),
      run("solo", 10, 400),
    ];
    const estimates = medianEstimates(runs, "solo", 5);
    expect(estimates?.[1]).toBe(250);
    expect(estimates?.[4]).toBeNull();
    expect(medianEstimates(runs, "duo", 5)).toBeNull();
  });
});
