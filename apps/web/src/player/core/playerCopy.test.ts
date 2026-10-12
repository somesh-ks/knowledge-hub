import { describe, expect, it } from "vitest";
import type { PlayerDigestData } from "../../types/contracts";
import {
  errorSummary,
  noticeAction,
  recordingCaption,
  toggleLabel,
  transportGlyph,
} from "./playerCopy";

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

  it("uses the episode's format, as the Library does", () => {
    const turn = (speaker: "a" | "b") => ({ speaker }) as never;
    expect(recordingCaption({ ...base, format: "readout", turns: [turn("a")] })).toBe(
      "Readout · 2 min",
    );
    expect(recordingCaption({ ...base, format: "headlines", turns: [turn("a")] })).toBe(
      "Readout · 2 min",
    );
    expect(recordingCaption({ ...base, format: "discussion", turns: [turn("a")] })).toBe(
      "Discussion · 2 min",
    );
  });

  it("takes the loaded audio's real length over the estimate", () => {
    expect(recordingCaption({ ...base, audio: { url: "/a", duration_ms: 300_000 } }, 130)).toBe(
      "Daily · 2 min",
    );
    expect(recordingCaption({ ...base, audio: null }, 130)).toBe("Daily · 2 min");
  });

  it("is only the kind before there is audio, and nothing without a recording", () => {
    expect(recordingCaption({ ...base, audio: null })).toBe("Daily");
    expect(recordingCaption(undefined)).toBe("");
  });
});

describe("a standing refusal", () => {
  const refused = { kind: "refused", message: "Daily narration limit reached." } as const;
  it("offers no Try again, in the notice or on the disc", () => {
    expect(noticeAction("refused")).toBeNull();
    expect(toggleLabel({ status: "error", error: refused })).toBe("Play");
    expect(transportGlyph("error", refused)).toBe("play");
  });
  it("gives the bar a line from the reason", () => {
    expect(errorSummary({ ...refused, summary: "Daily limit reached" })).toBe(
      "Daily limit reached",
    );
    expect(errorSummary({ kind: "network" })).toBe("Audio did not load");
  });
});

describe("transportGlyph", () => {
  it("draws what the button is named", () => {
    // The disc and the bar share one rule: the glyph never disagrees with the name.
    expect(transportGlyph("error")).toBe("refresh");
    expect(toggleLabel({ status: "error" })).toBe("Try again");
    expect(transportGlyph("ended")).toBe("replay");
    expect(toggleLabel({ status: "ended" })).toBe("Play again");
    for (const status of ["idle", "paused"] as const) {
      expect(transportGlyph(status)).toBe("play");
      expect(toggleLabel({ status })).toBe("Play");
    }
    for (const status of ["playing", "loading"] as const) {
      expect(transportGlyph(status)).toBe("pause");
      expect(toggleLabel({ status })).toBe("Pause");
    }
  });
});
