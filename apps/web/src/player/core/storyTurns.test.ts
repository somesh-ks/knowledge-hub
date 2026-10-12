import { describe, expect, it } from "vitest";
import { storyTurns } from "./storyTurns";

const item = (id: string, text?: string, start: number | null = null) => ({
  id,
  headline: `Headline ${id}`,
  section: "top",
  source: "Example",
  ...(text ? { text } : {}),
  start_ms: start,
  end_ms: start === null ? null : start + 1000,
});

describe("storyTurns", () => {
  // Without these a briefing had no transcript to switch to, so the player showed one list and no tabs.
  it("makes a turn of each story with words, keeping its headline and its times", () => {
    const turns = storyTurns([item("a", "First story.", 0), item("b"), item("c", "Third.")]);
    expect(turns.map((turn) => [turn.key, turn.title, turn.text, turn.start_ms])).toEqual([
      ["a", "Headline a", "First story.", 0],
      ["c", "Headline c", "Third.", null],
    ]);
  });
});
