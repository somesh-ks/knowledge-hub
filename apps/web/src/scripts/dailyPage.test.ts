import { describe, expect, it } from "vitest";
import { modelOp, parseModelList, scheduleOp } from "./dailyPage";

describe("scheduleOp", () => {
  it("builds schedule.set with the type and length, and passes the saved topics through", () => {
    const values = { hour: 9, cadence: 3, format: "headlines", length: 5 };
    expect(scheduleOp(values, null)).toEqual({
      op: "schedule.set",
      hour: 9,
      cadence_days: 3,
      sections: null,
      format: "headlines",
      length_minutes: 5,
    });
    expect(scheduleOp(values, ["ai"])).toMatchObject({ sections: ["ai"] });
  });
});

describe("modelOp", () => {
  it("builds writer.set for a model and for Automatic", () => {
    expect(modelOp("a/b")).toEqual({ op: "writer.set", provider: "nebius", model: "a/b" });
    expect(modelOp(null)).toEqual({ op: "writer.set", provider: "nebius", model: null });
    expect(modelOp("claude-haiku-5-5", "anthropic")).toEqual({
      op: "writer.set",
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
  });
});

describe("parseModelList", () => {
  it("reads the API's shape and skips ids that are not valid", () => {
    expect(
      parseModelList({
        provider: "nebius",
        models: [
          { id: "a/b", context_length: 4096 },
          { id: "bad id", context_length: 1 },
          { id: "c", context_length: null },
        ],
      }),
    ).toEqual([
      { id: "a/b", context_length: 4096 },
      { id: "c", context_length: null },
    ]);
  });

  it("refuses anything else", () => {
    for (const bad of [null, "x", {}, { models: "no" }, { models: [1] }]) {
      expect(parseModelList(bad)).toBeNull();
    }
  });
});
