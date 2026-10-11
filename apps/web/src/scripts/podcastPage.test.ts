import { describe, expect, it } from "vitest";
import { modelOp, parseModelList } from "./podcastPage";
import { scheduleOp } from "./podcastProfiles";

describe("scheduleOp", () => {
  const was = {
    "daily.hour": "7",
    "daily.format": "readout",
    "daily.voice": "",
    "weekly.enabled": "true",
    "weekly.day": "0",
    "weekly.length": "10",
    "custom.voice_b": "",
  };

  it("is null while nothing differs", () => {
    expect(scheduleOp(was, { ...was })).toBeNull();
  });

  it("sends only the changed fields, each in its own profile", () => {
    const now = {
      ...was,
      "daily.hour": "9",
      "daily.voice": "v1",
      "weekly.enabled": "false",
      "weekly.day": "5",
      "custom.voice_b": "v2",
    };
    expect(scheduleOp(was, now)).toEqual({
      op: "schedule.set",
      hour: 9,
      voice_id: "v1",
      weekly: { enabled: false, day: 5 },
      custom: { voice_id_b: "v2" },
    });
  });

  it("turns the default voice back into null and the cadence into days", () => {
    expect(
      scheduleOp(
        { "daily.voice": "v1", "daily.cadence": "2" },
        { "daily.voice": "", "daily.cadence": "7" },
      ),
    ).toEqual({
      op: "schedule.set",
      voice_id: null,
      cadence_days: 7,
    });
  });
});

describe("scheduleOp: topics", () => {
  it("sends the ticked topics, null for all of them, in each profile, and never an empty list", () => {
    const was = { "daily.sections": "*", "weekly.sections": "ai,design" };
    expect(scheduleOp(was, { "daily.sections": "ai", "weekly.sections": "*" })).toEqual({
      op: "schedule.set",
      sections: ["ai"],
      weekly: { sections: null },
    });
    expect(scheduleOp(was, { "daily.sections": "", "weekly.sections": "ai,design" })).toBeNull();
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
