import { describe, expect, it } from "vitest";
import {
  clockParts,
  clockSizerParts,
  formatClock,
  formatRemaining,
  longDateFromDigestId,
  monthLabelFromDate,
} from "./formatTime";
import { makeDigest, makeDigestWithoutAudio } from "./testing";
import {
  buildTimeline,
  findItemIndexById,
  fractionWithinItem,
  itemIndexAt,
  itemPositionLabel,
  sectionIndexOfItem,
  storyCaption,
  storySectionName,
} from "./timeline";

describe("buildTimeline", () => {
  it("converts marks to seconds and closes each section at the next one", () => {
    const timeline = buildTimeline(makeDigest());
    expect(timeline?.durationSec).toBe(120);
    expect(timeline?.items.map((item) => [item.startSec, item.endSec])).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
      [90, 120],
    ]);
    expect(
      timeline?.sections.map((section) => [section.slug, section.startSec, section.endSec]),
    ).toEqual([
      ["top", 0, 30],
      ["ui-craft", 30, 60],
      ["ai", 60, 120],
    ]);
    expect(timeline?.sections.map((section) => section.firstIndex)).toEqual([0, 1, 2]);
  });

  it("returns null for a digest without audio", () => {
    expect(buildTimeline(makeDigestWithoutAudio())).toBeNull();
  });

  it("drops items without marks instead of guessing their position", () => {
    const base = makeDigest();
    const digest = makeDigest({
      items: base.items.map((item, index) =>
        index === 2 ? { ...item, start_ms: null, end_ms: null } : item,
      ),
    });
    const timeline = buildTimeline(digest);
    expect(timeline?.items).toHaveLength(3);
    expect(timeline?.items.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it("clamps marks that run past the audio and never makes a negative-length item", () => {
    const digest = makeDigest({
      audio: { url: "/a.mp3", duration_ms: 50_000 },
    });
    const timeline = buildTimeline(digest);
    for (const item of timeline?.items ?? []) {
      expect(item.startSec).toBeLessThanOrEqual(50);
      expect(item.endSec).toBeGreaterThanOrEqual(item.startSec);
      expect(item.endSec).toBeLessThanOrEqual(50);
    }
  });

  it("skips sections with no items", () => {
    const base = makeDigest();
    const digest = makeDigest({
      sections: [...base.sections, { slug: "watch", title: "Watch and listen", start_ms: 110_000 }],
    });
    expect(buildTimeline(digest)?.sections.map((section) => section.slug)).not.toContain("watch");
  });
});

describe("item lookup", () => {
  const timeline = buildTimeline(makeDigest());

  it("finds the item under a time with a binary search, including exact starts", () => {
    expect(itemIndexAt(timeline, 0)).toBe(0);
    expect(itemIndexAt(timeline, 29.99)).toBe(0);
    expect(itemIndexAt(timeline, 30)).toBe(1);
    expect(itemIndexAt(timeline, 89)).toBe(2);
    expect(itemIndexAt(timeline, 500)).toBe(3);
  });

  it("answers 0 when there is no timeline", () => {
    expect(itemIndexAt(null, 40)).toBe(0);
  });

  it("maps an item to its section", () => {
    expect(sectionIndexOfItem(timeline, 0)).toBe(0);
    expect(sectionIndexOfItem(timeline, 3)).toBe(2);
  });

  it("interpolates inside an item for the rail, clamped at both ends", () => {
    const item = timeline?.items[1];
    if (!item) throw new Error("missing item");
    expect(fractionWithinItem(item, 30)).toBe(0);
    expect(fractionWithinItem(item, 45)).toBe(0.5);
    expect(fractionWithinItem(item, 70)).toBe(1);
    expect(fractionWithinItem(item, 1)).toBe(0);
  });

  it("finds an item by its id and labels its position for people", () => {
    expect(findItemIndexById(timeline, "c1b2c3d4e5f6")).toBe(2);
    expect(findItemIndexById(timeline, "nope")).toBe(-1);
    expect(itemPositionLabel(timeline, 4 - 1)).toBe("Story 4 of 4");
    expect(storyCaption(timeline, 1, "Design engineering")).toBe(
      "Story 2 of 4 · Design engineering",
    );
    expect(storyCaption(timeline, 0, "")).toBe("Story 1 of 4");
    // An episode's one section is a placeholder: its position is told without it.
    const digest = makeDigest();
    expect(storySectionName(digest, { title: "Top picks" })).toBe("Top picks");
    expect(storySectionName({ ...digest, kind: "on-demand" }, { title: "Stories" })).toBe("");
    expect(itemPositionLabel(null, 0)).toBe("");
  });
});

describe("time formatting", () => {
  it("formats minutes and hours, floors, and never goes negative", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(86.9)).toBe("1:26");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-4)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });

  it("splits a clock around its last colon for the fixed-width colon box", () => {
    expect(clockParts(86)).toEqual({ before: "1", after: "26" });
    expect(clockParts(3725)).toEqual({ before: "1:02", after: "05" });
  });

  it("sizes a clock by the widest time it can show, as zeros", () => {
    expect(clockSizerParts(754)).toEqual({ before: "00", after: "00" });
    expect(clockSizerParts(86)).toEqual({ before: "0", after: "00" });
    expect(clockSizerParts(3725)).toEqual({ before: "0:00", after: "00" });
  });

  it("shows the remaining time with a minus", () => {
    expect(formatRemaining(86, 211)).toBe("-2:05");
    expect(formatRemaining(300, 211)).toBe("-0:00");
  });

  it("writes dates the way the voice does", () => {
    expect(longDateFromDigestId("2026-10-07")).toBe("Wednesday 7 October");
    expect(longDateFromDigestId("2026-10-04-weekly")).toBe("Sunday 4 October");
    expect(longDateFromDigestId("not-a-date")).toBe("not-a-date");
    expect(monthLabelFromDate("2026-10-07")).toBe("October 2026");
  });
});
