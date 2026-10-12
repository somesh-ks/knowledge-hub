import { describe, expect, it } from "vitest";
import { GENERATE_STEPS } from "../types/contracts";
import {
  BRIEFING_STAGES,
  BRIEFING_UPDATING_LABEL,
  briefingStage,
  EPISODE_STAGES,
  episodeStage,
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
