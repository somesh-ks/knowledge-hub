import { describe, expect, it } from "vitest";
import type { PlayerDigestData } from "../../types/contracts";
import { recordingCaption } from "./playerCopy";

const base = {
  id: "d",
  date: "2026-10-07",
  title: "Wednesday 7 October",
  kind: "regular",
  audio: { url: "/a.mp3", duration_ms: 130_000 },
  timeline: "estimated",
  items: [],
  sections: [],
  cover: { src512: "", src1024: "", key: "" },
  prev_id: null,
  next_id: null,
} as unknown as PlayerDigestData;

describe("recordingCaption", () => {
  it("says what the Library says: kind, then length, with a middle dot", () => {
    expect(recordingCaption(base)).toBe("Daily · 2 min");
    expect(recordingCaption({ ...base, kind: "weekly" })).toBe("Weekly · 2 min");
  });

  it("calls an episode with two voices a discussion and any other an episode", () => {
    const turn = (speaker: "a" | "b") => ({ speaker }) as never;
    expect(recordingCaption({ ...base, turns: [turn("a"), turn("b")] })).toBe("Discussion · 2 min");
    expect(recordingCaption({ ...base, turns: [turn("a")] })).toBe("Episode · 2 min");
  });

  it("is only the kind before there is audio, and nothing without a recording", () => {
    expect(recordingCaption({ ...base, audio: null })).toBe("Daily");
    expect(recordingCaption(undefined)).toBe("");
  });
});
