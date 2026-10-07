import { describe, expect, it } from "vitest";
import { makeDigest, makeItem, makeTimeline } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { AUDIO_UNAVAILABLE_COPY, buildHero, buildSections, storyCount } from "./digestView";

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
  it("keeps reading-order indexes", () => {
    const sections = buildSections(entryFor());
    expect(sections.map((section) => section.slug)).toEqual(["top", "ai", "research"]);
    expect(sections[0]?.items.map(({ index }) => index)).toEqual([0, 1]);
    expect(sections[1]?.items.map(({ index }) => index)).toEqual([2]);
  });

  it("points each section at its first item", () => {
    const sections = buildSections(entryFor());
    expect(sections.map((section) => section.firstIndex)).toEqual([0, 2, 3]);
  });

  it("omits a section with no items", () => {
    const entry = entryFor({ items: [makeItem(1, "top"), makeItem(2, "top"), makeItem(3, "top")] });
    expect(buildSections(entry).map((section) => section.slug)).toEqual(["top"]);
  });

  it("has no section or story lengths without audio", () => {
    const sections = buildSections(entryFor());
    expect(sections.every((section) => section.clock === null)).toBe(true);
    const stories = sections.flatMap((section) => section.items);
    expect(stories.every(({ length }) => length === "")).toBe(true);
  });

  it("measures each section from the timeline", () => {
    const sections = buildSections(entryFor({}, true));
    // Two top items at three seconds each, then one item per later section.
    expect(sections.map((section) => section.clock)).toEqual(["0:06", "0:03", "0:03"]);
  });

  it("gives each story its share of the recording", () => {
    const stories = buildSections(entryFor({}, true)).flatMap((section) => section.items);
    expect(stories.map(({ length }) => length)).toEqual(["0:03", "0:03", "0:03", "0:03"]);
  });
});

describe("buildHero", () => {
  it("writes one meta line: stories, reading time, listening time", () => {
    const hero = buildHero(entryFor(), "Wednesday 7 October");
    expect(hero.title).toBe("Wednesday 7 October");
    expect(hero.meta).toEqual(["4 stories", "2 min read", "4 min listen"]);
  });

  it("labels the play chip with the estimate until the recording exists", () => {
    expect(buildHero(entryFor(), "x").length).toBe("4 min");
  });

  it("uses the length of the recording once there is one, on the chip and in the meta line", () => {
    const audio = { url: "https://example.com/a.mp3", duration_ms: 452_000 };
    const hero = buildHero(entryFor({ audio }, true), "x");
    expect(hero.length).toBe("8 min");
    expect(hero.meta.at(-1)).toBe("8 min listen");
  });

  it("says stories, with the singular for one", () => {
    expect(storyCount(1)).toBe("1 story");
    expect(storyCount(17)).toBe("17 stories");
  });
});

describe("audio copy", () => {
  it("explains both unavailable states in plain words", () => {
    expect(AUDIO_UNAVAILABLE_COPY.preparing.label).toBe("Audio is still being prepared");
    expect(AUDIO_UNAVAILABLE_COPY.expired.label).toBe("The audio has expired");
    for (const copy of Object.values(AUDIO_UNAVAILABLE_COPY)) {
      // Voice rule: plain sentences, no dashes (the dash characters are built, not typed, here).
      const dashes = [0x2013, 0x2014].map((code) => String.fromCharCode(code));
      for (const dash of dashes) expect(copy.hint).not.toContain(dash);
    }
  });
});
