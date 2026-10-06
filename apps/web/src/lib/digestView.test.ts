import { describe, expect, it } from "vitest";
import { makeDigest, makeItem, makeTimeline } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { AUDIO_UNAVAILABLE_COPY, buildHero, buildSections } from "./digestView";

function entryFor(overrides: Parameters<typeof makeDigest>[0] = {}, withTimeline = false) {
  const digest = makeDigest({
    audio: withTimeline ? { url: "https://example.com/a.mp3", duration_ms: 12_000 } : null,
    ...overrides,
  });
  const entry = buildEntries([{ digest, timeline: withTimeline ? makeTimeline(digest) : null }])[0];
  if (!entry) throw new Error("no entry");
  return entry;
}

describe("buildSections", () => {
  it("keeps reading-order indexes and marks the first item as the lead", () => {
    const sections = buildSections(entryFor());
    expect(sections.map((section) => section.slug)).toEqual(["top", "ai", "research"]);
    expect(sections[0]?.items.map(({ index }) => index)).toEqual([0, 1]);
    expect(sections[0]?.items.map(({ isLead }) => isLead)).toEqual([true, false]);
    expect(sections[1]?.items.map(({ index }) => index)).toEqual([2]);
  });

  it("points each chapter at its first item", () => {
    const sections = buildSections(entryFor());
    expect(sections.map((section) => section.firstIndex)).toEqual([0, 2, 3]);
  });

  it("omits a section with no items", () => {
    const entry = entryFor({ items: [makeItem(1, "top"), makeItem(2, "top"), makeItem(3, "top")] });
    expect(buildSections(entry).map((section) => section.slug)).toEqual(["top"]);
  });

  it("has no chapter clocks without audio", () => {
    expect(buildSections(entryFor()).every((section) => section.clock === null)).toBe(true);
  });

  it("measures each chapter from the timeline", () => {
    const sections = buildSections(entryFor({}, true));
    // Two top items at three seconds each, then one item per later section.
    expect(sections.map((section) => section.clock)).toEqual(["0:06", "0:03", "0:03"]);
  });
});

describe("buildHero", () => {
  it("writes the count and time lines", () => {
    const hero = buildHero(entryFor(), "Wednesday 7 October");
    expect(hero.title).toBe("Wednesday 7 October");
    expect(hero.countLine).toBe("4 items since Monday");
    expect(hero.timeLine).toBe("2 min to read, 4 to listen");
  });

  it("shows the audio length only when the audio is ready", () => {
    expect(buildHero(entryFor({}, true), "x").clock).toBe("0:12");
    expect(buildHero(entryFor(), "x").clock).toBeNull();
  });

  it("uses the singular for a single item", () => {
    // A digest needs three items, so build the view from a hand-trimmed entry.
    const entry = entryFor();
    entry.digest.items.length = 1;
    expect(buildHero(entry, "x").countLine).toBe("1 item since Monday");
  });
});

describe("audio copy", () => {
  it("explains both unavailable states in plain words", () => {
    expect(AUDIO_UNAVAILABLE_COPY.preparing.label).toBe("Audio is still being prepared");
    expect(AUDIO_UNAVAILABLE_COPY.expired.label).toBe("The audio has expired");
    for (const copy of Object.values(AUDIO_UNAVAILABLE_COPY)) {
      expect(copy.hint).not.toMatch(/[–—]/);
    }
  });
});
