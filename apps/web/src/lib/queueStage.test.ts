import { describe, expect, it } from "vitest";
import { stageKind } from "./queueStage";
import { BRIEFING_STAGES, EPISODE_STAGES, NAMED_EPISODE_STAGES } from "./runStages";

const running = { state: "running" as const };

describe("what stage a run is in, for its icon", () => {
  // The queue shows a waveform while the voices are made. A list that changes
  // length (a stage added to run.yml) would silently shift every icon one stage early or late.
  it("reads the kind from the position in each stage list the engine reports", () => {
    const kinds = (what: "briefing" | "episode", stages: number) =>
      Array.from({ length: stages }, (_, stage) => stageKind({ ...running, what, stage, stages }));
    expect(kinds("episode", NAMED_EPISODE_STAGES.length)).toEqual([
      "gather",
      "write",
      "art",
      "publish",
      "voices",
      "finish",
    ]);
    expect(kinds("briefing", BRIEFING_STAGES.length)).toEqual([
      "wait",
      "gather",
      "choose",
      "write",
      "check",
      "publish",
      "finish",
    ]);
    expect(kinds("episode", EPISODE_STAGES.length)).toEqual(["wait", "write", "finish"]);
  });

  it("calls a queued run waiting, and a list of an unknown shape plain writing", () => {
    expect(stageKind({ state: "queued", what: "episode", stage: 3, stages: 6 })).toBe("wait");
    expect(stageKind({ ...running, what: "episode", stage: 1, stages: 9 })).toBe("write");
  });
});
