import { describe, expect, it } from "vitest";
import {
  countText,
  hintFor,
  matchesFilter,
  modelOp,
  parseModelList,
  rowsFor,
  scheduleOp,
} from "./dailyPage";

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

describe("rowsFor", () => {
  const live = [{ id: "a/x", context_length: 1 }];

  it("adds a saved model the live list no longer has, first", () => {
    expect(rowsFor(live, "gone/m")).toEqual([{ id: "gone/m", context_length: null }, ...live]);
    expect(rowsFor(live, "a/x")).toEqual(live);
    expect(rowsFor(live, null)).toEqual(live);
  });
});

describe("matchesFilter and countText", () => {
  it("matches id substrings without regard to case", () => {
    expect(matchesFilter("meta-llama/Llama-3.3", "LLAMA")).toBe(true);
    expect(matchesFilter("meta-llama/Llama-3.3", "meta-l")).toBe(true);
    expect(matchesFilter("meta-llama/Llama-3.3", "qwen")).toBe(false);
    expect(matchesFilter("anything", "  ")).toBe(true);
  });

  it("words the count", () => {
    expect(countText(0)).toBe("No models match");
    expect(countText(1)).toBe("1 model");
    expect(countText(12)).toBe("12 models");
  });
});

describe("hintFor", () => {
  it("joins the vendor and the context window", () => {
    expect(hintFor({ id: "meta-llama/L", context_length: 131072 }, true)).toBe(
      "meta-llama, 128k context",
    );
    expect(hintFor({ id: "plain", context_length: null }, true)).toBe("");
  });

  it("says when a saved model has left the list", () => {
    expect(hintFor({ id: "gone/m", context_length: null }, false)).toBe(
      "gone, Not in the live list",
    );
  });
});
