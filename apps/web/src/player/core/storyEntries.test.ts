import { describe, expect, it } from "vitest";
import type { PlayerDigestData } from "../../types/contracts";
import { steppedStory, storyEntries } from "./storyEntries";
import type { Timeline } from "./timeline";

const digest = {
  items: [
    { id: "a", headline: "First", section: "top", start_ms: null, end_ms: null },
    { id: "b", headline: "Second", section: "top", start_ms: null, end_ms: null },
  ],
  sections: [{ slug: "top", title: "Top picks", start_ms: null }],
} as unknown as PlayerDigestData;

describe("storyEntries", () => {
  it("lists the digest's items when the timeline has no stories on it", () => {
    const empty: Timeline = { durationSec: 130, items: [], sections: [] };
    const entries = storyEntries(empty, digest);
    expect(entries.timed).toBe(false);
    expect(entries.items.map((item) => item.headline)).toEqual(["First", "Second"]);
    expect(entries.sections).toEqual([{ slug: "top", title: "Top picks" }]);
    expect(entries.items[0]?.durationSec).toBeNull();
  });

  it("uses the timeline when it has stories, and they can be played", () => {
    const timeline: Timeline = {
      durationSec: 10,
      items: [
        {
          id: "a",
          index: 0,
          startSec: 0,
          endSec: 4,
          headline: "First",
          source: "",
          url: null,
          section: "top",
        },
      ],
      sections: [{ slug: "top", title: "Top picks", startSec: 0, endSec: 10, firstIndex: 0 }],
    };
    const entries = storyEntries(timeline, digest);
    expect(entries.timed).toBe(true);
    expect(entries.items).toHaveLength(1);
    expect(entries.items[0]?.durationSec).toBe(4);
  });

  it("keeps items whose section the digest does not name", () => {
    const loose = { ...digest, sections: [] } as unknown as PlayerDigestData;
    expect(storyEntries(null, loose).sections).toEqual([{ slug: "top", title: "Stories" }]);
  });

  const turn = (text: string, item_id: string | null, start_ms: number | null = null) => ({
    key: `t${text.length}`,
    speaker: "a" as const,
    text,
    item_id,
    start_ms,
    end_ms: start_ms === null ? null : start_ms + text.length * 62,
  });

  it("places an episode's stories by its script before the narration is laid out", () => {
    const episode = {
      ...digest,
      turns: [
        turn("Hello there.", null),
        turn("First story, part one.", "a"),
        turn("First story, part two.", "a"),
        turn("Second story.", "b"),
      ],
    } as unknown as PlayerDigestData;
    const entries = storyEntries(null, episode);
    expect(entries.timed).toBe(false);
    const [first, second] = entries.items;
    // The intro's 12 characters at 62 ms each, then the first story's two turns.
    expect(first?.startSec).toBeCloseTo(0.744);
    expect(second?.startSec).toBeCloseTo(0.744 + 44 * 0.062);
    expect(first?.durationSec).toBeCloseTo(44 * 0.062);
  });

  it("takes a turn's real place once it is known", () => {
    const episode = {
      ...digest,
      turns: [turn("Intro.", null, 0), turn("First.", "a", 10_000), turn("Second.", "b")],
    } as unknown as PlayerDigestData;
    const [first, second] = storyEntries(null, episode).items;
    expect(first?.startSec).toBe(10);
    expect(second?.startSec).toBeCloseTo(10 + 6 * 0.062);
  });

  it("leaves a briefing's untimed stories unplaced", () => {
    expect(storyEntries(null, digest).items[0]?.startSec).toBeNull();
  });
});

describe("steppedStory", () => {
  const entries = [
    { id: "a", index: 0, headline: "", section: "top", durationSec: 5, startSec: 2 },
    { id: "b", index: 1, headline: "", section: "top", durationSec: 5, startSec: 7 },
  ];

  it("goes to the next story start, and back to the start of the one being heard", () => {
    expect(steppedStory(entries, 0, 1)?.id).toBe("a");
    expect(steppedStory(entries, 3, 1)?.id).toBe("b");
    expect(steppedStory(entries, 8, 1)).toBeNull();
    expect(steppedStory(entries, 8, -1)?.id).toBe("b");
    // In the rundown before story a, Previous has no story behind it (it never goes forward).
    expect(steppedStory(entries, 0, -1)).toBeNull();
  });

  it("has nowhere to go without placed stories", () => {
    expect(steppedStory([{ ...entries[0], startSec: null } as never], 0, 1)).toBeNull();
  });
});
