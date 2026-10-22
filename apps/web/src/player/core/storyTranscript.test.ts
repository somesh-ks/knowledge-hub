import { describe, expect, it } from "vitest";
import { transcriptRange } from "./storyTranscript";

const turns = [
  { item_id: null },
  { item_id: "a" },
  { item_id: null },
  { item_id: "b" },
  { item_id: "b" },
  { item_id: null },
];

describe("transcriptRange", () => {
  it("shows the rundown before story 1, and only that", () => {
    expect(transcriptRange(turns, null)).toEqual({ from: 0, to: 1 });
  });

  it("shows a story with the unattached turns after it, and no other story", () => {
    expect(transcriptRange(turns, "a")).toEqual({ from: 1, to: 3 });
    expect(transcriptRange(turns, "b")).toEqual({ from: 3, to: 6 });
  });

  it("shows nothing for a story with no turn, or a recording with no rundown", () => {
    expect(transcriptRange(turns, "z")).toBeNull();
    expect(transcriptRange([{ item_id: "a" }], null)).toBeNull();
  });
});
