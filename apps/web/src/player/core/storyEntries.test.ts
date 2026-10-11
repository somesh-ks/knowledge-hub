import { describe, expect, it } from "vitest";
import type { PlayerDigestData } from "../../types/contracts";
import { storyEntries } from "./storyEntries";
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
});
