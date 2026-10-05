import type { Digest, Section } from "@dispatch/core";
import { SECTION_TITLES, SECTIONS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  buildSpokenText,
  MAX_SPOKEN_CHARS,
  SpokenTextError,
  SpokenTextTooLongError,
  toSpeech,
} from "../src/audio/spokenText.js";
import { makeDigest, makeItem, must } from "./audio-fixtures.js";

function digestWith(sections: Section[], overrides: Partial<Digest> = {}): Digest {
  return makeDigest({
    ...overrides,
    items: sections.map((section, index) => makeItem(index, { section })),
  });
}

describe("buildSpokenText opening line", () => {
  it("opens with the date and the count as a word", () => {
    const digest = makeDigest({}, 11);
    expect(
      buildSpokenText(digest).text.startsWith("Dispatch, Wednesday 7 October. Eleven items."),
    ).toBe(true);
  });

  it.each([
    [3, "Three items."],
    [8, "Eight items."],
    [12, "Twelve items."],
    [18, "Eighteen items."],
  ])("spells %i as a word", (count, expected) => {
    expect(buildSpokenText(makeDigest({}, count)).text).toContain(expected);
  });

  it("says 'One item.' for a single item", () => {
    expect(buildSpokenText(makeDigest({}, 1)).text).toContain(
      "Dispatch, Wednesday 7 October. One item.",
    );
  });

  it("falls back to digits above eighteen", () => {
    expect(buildSpokenText(makeDigest({}, 19)).text).toContain("19 items.");
  });

  it("names the weekly pass", () => {
    const text = buildSpokenText(
      makeDigest({ kind: "weekly", id: "2026-10-11-weekly", date: "2026-10-11" }, 4),
    ).text;
    expect(text.startsWith("Dispatch weekly, Sunday 11 October. Four items.")).toBe(true);
  });
});

describe("buildSpokenText structure", () => {
  it("uses the section title as the only transition, in section order", () => {
    const digest = digestWith(["ai", "top", "research", "ui-craft", "top"]);
    const { text, sectionStarts } = buildSpokenText(digest);
    expect(sectionStarts.map((section) => section.slug)).toEqual([
      "top",
      "ui-craft",
      "ai",
      "research",
    ]);
    for (const section of sectionStarts) {
      expect(text.slice(section.start).startsWith(`${SECTION_TITLES[section.slug]}.`)).toBe(true);
    }
  });

  it("skips sections that have no items", () => {
    const { sectionStarts } = buildSpokenText(digestWith(["research", "research", "research"]));
    expect(sectionStarts).toEqual([{ slug: "research", start: expect.any(Number) }]);
  });

  it("keeps digest order inside a section", () => {
    const digest = digestWith(["top", "ai", "top"]);
    const { ranges } = buildSpokenText(digest);
    expect(ranges.map((range) => range.id)).toEqual(
      [digest.items[0], digest.items[2], digest.items[1]].map((item) => must(item).id),
    );
  });

  it("indexes ranges exactly into the final string", () => {
    const digest = makeDigest({}, 9);
    const { text, ranges } = buildSpokenText(digest);
    expect(ranges).toHaveLength(9);
    for (const range of ranges) {
      const item = must(digest.items.find((candidate) => candidate.id === range.id));
      const block = text.slice(range.start, range.end);
      expect(block.startsWith(item.headline)).toBe(true);
      expect(block).toContain(item.summary);
      expect(block.endsWith(`${item.why}.`)).toBe(true);
      expect(range.section).toBe(item.section);
    }
  });

  it("keeps ranges ordered, disjoint and inside the text", () => {
    const { text, ranges } = buildSpokenText(makeDigest({}, 12));
    let previousEnd = 0;
    for (const range of ranges) {
      expect(range.start).toBeGreaterThanOrEqual(previousEnd);
      expect(range.end).toBeGreaterThan(range.start);
      previousEnd = range.end;
    }
    expect(previousEnd).toBeLessThanOrEqual(text.length);
  });

  it("places each section start before that section's first item", () => {
    const { ranges, sectionStarts } = buildSpokenText(makeDigest({}, 12));
    for (const section of sectionStarts) {
      const first = must(ranges.find((range) => range.section === section.slug));
      expect(section.start).toBeLessThan(first.start);
    }
  });

  it("ends on the last item with no outro", () => {
    const digest = makeDigest({}, 5);
    const { text, ranges } = buildSpokenText(digest);
    expect(text.endsWith(`${must(digest.items.at(-1)).why}.`)).toBe(true);
    expect(must(ranges.at(-1)).end).toBe(text.length);
    expect(text.toLowerCase()).not.toContain("that was");
  });

  it("drops the 'Why:' prefix, URLs and markdown", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, {
          summary:
            "See [the post](https://example.com/a) for **details** at https://example.com/b.",
        }),
        makeItem(1),
        makeItem(2),
      ],
    });
    const { text } = buildSpokenText(digest);
    expect(text).not.toContain("Why:");
    expect(text).not.toMatch(/https?:|www\.|\]\(|\*\*|`/);
    expect(text).toContain("See the post for details at.");
    expect(text).not.toContain("example.com");
  });

  it("adds a full stop to a headline that lacks one and not to one that has it", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, { headline: "Springlet 2.0 ships" }),
        makeItem(1, { headline: "Is it ready?" }),
        makeItem(2),
      ],
    });
    const { text } = buildSpokenText(digest);
    expect(text).toContain("Springlet 2.0 ships. ");
    expect(text).toContain("Is it ready? ");
    expect(text).not.toContain("ready?.");
  });

  it("normalizes each field before the ranges are measured", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, { headline: "R&D tools", summary: "Uses client/server splits." }),
        makeItem(1),
        makeItem(2),
      ],
    });
    const { text, ranges } = buildSpokenText(digest);
    const first = must(ranges[0]);
    expect(text.slice(first.start, first.end)).toContain(
      "R and D tools. Uses client slash server splits.",
    );
  });

  it("fails when an item has nothing speakable", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, {
          headline: "https://a.example",
          summary: "https://b.example",
          why: "https://c.example",
        }),
        makeItem(1),
        makeItem(2),
      ],
    });
    expect(() => buildSpokenText(digest)).toThrow(SpokenTextError);
  });

  it("covers every section title in SECTION_TITLES", () => {
    const { text } = buildSpokenText(digestWith([...SECTIONS]));
    for (const section of SECTIONS) expect(text).toContain(`${SECTION_TITLES[section]}.`);
  });
});

describe("buildSpokenText length limit", () => {
  function lengthWith(padding: number): { length: number; digest: Digest } {
    const base = makeDigest({}, 3);
    const digest = makeDigest({
      items: base.items.map((item, index) =>
        index === 0 ? { ...item, summary: `${"a".repeat(padding)}` } : item,
      ),
    });
    return { digest, length: toSpeech(digest.items[0]?.summary ?? "").length };
  }

  it("accepts text of exactly 19,000 characters and rejects one more", () => {
    const probe = lengthWith(10);
    const baseLength = buildSpokenText(probe.digest).text.length;
    const exact = lengthWith(10 + (MAX_SPOKEN_CHARS - baseLength));
    // The summary gains a full stop, so account for the single appended character.
    expect(buildSpokenText(exact.digest).text.length).toBe(MAX_SPOKEN_CHARS);
    const over = lengthWith(10 + (MAX_SPOKEN_CHARS - baseLength) + 1);
    expect(() => buildSpokenText(over.digest)).toThrow(SpokenTextTooLongError);
  });

  it("reports the length and the limit", () => {
    const { digest } = lengthWith(MAX_SPOKEN_CHARS + 500);
    try {
      buildSpokenText(digest);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SpokenTextTooLongError);
      expect((error as SpokenTextTooLongError).limit).toBe(MAX_SPOKEN_CHARS);
      expect((error as SpokenTextTooLongError).length).toBeGreaterThan(MAX_SPOKEN_CHARS);
    }
  });

  it("keeps a realistic weekly digest well under the limit", () => {
    expect(buildSpokenText(makeDigest({ kind: "weekly" }, 18)).text.length).toBeLessThan(
      MAX_SPOKEN_CHARS / 2,
    );
  });
});

describe("toSpeech", () => {
  it.each([
    ["Design & engineering", "Design and engineering"],
    ["R&D budgets", "R and D budgets"],
    ["Q&A session", "Q and A session"],
    ["AT&T network", "AT and T network"],
    ["Fish &amp; chips", "Fish and chips"],
  ])("reads the ampersand in %j", (input, expected) => {
    expect(toSpeech(input)).toBe(expected);
  });

  it.each([
    ["client/server split", "client slash server split"],
    ["and/or", "and or"],
    ["input / output", "input slash output"],
    ["src/components/Button", "src slash components slash Button"],
    ["H.264/AAC", "H.264 slash AAC"],
    ["24/7 support", "24/7 support"],
    ["on 10/12", "on 10/12"],
  ])("handles the slash in %j", (input, expected) => {
    expect(toSpeech(input)).toBe(expected);
  });

  it.each([
    ["Tailwind v4 lands", "Tailwind version 4 lands"],
    ["Springlet v2.0 ships", "Springlet version 2.0 ships"],
    ["Release 1.2.3 is out", "Release 1 point 2 point 3 is out"],
    ["v1.2.3", "version 1 point 2 point 3"],
    ["Springlet 2.0 ships", "Springlet 2.0 ships"],
    ["V8 engine", "V8 engine"],
    ["Node 24 and iOS 26.1", "Node 24 and iOS 26.1"],
  ])("reads version numbers naturally in %j", (input, expected) => {
    expect(toSpeech(input)).toBe(expected);
  });

  it.each([
    ["Use e.g. springs", "Use for example springs"],
    ["Use (e.g., springs)", "Use (for example, springs)"],
    ["That is, i.e. fast", "That is, that is fast"],
    ["Springs vs. easing", "Springs versus easing"],
    ["Springs vs easing", "Springs versus easing"],
    ["Springs, easing, etc. Then more", "Springs, easing, et cetera. Then more"],
    ["Springs, easing, etc.", "Springs, easing, et cetera."],
    ["Springs and etc. in code", "Springs and et cetera in code"],
    ["Works w/o a build step", "Works without a build step"],
    ["Ships w/ a CLI", "Ships with a CLI"],
    ["Roughly approx. five", "Roughly approximately five"],
  ])("expands abbreviations in %j", (input, expected) => {
    expect(toSpeech(input)).toBe(expected);
  });

  it("strips markdown and URLs but keeps link labels", () => {
    expect(toSpeech("# Title\n- a **bold** [link](https://x.example/p) and `code`")).toBe(
      "Title a bold link and code",
    );
    expect(toSpeech("Visit www.example.com now")).toBe("Visit now");
    expect(toSpeech("Read ![diagram](https://x.example/d.png) first")).toBe("Read diagram first");
  });

  it("removes emoji and variation selectors", () => {
    expect(toSpeech("Shipped \u{1F680} today \u2764\uFE0F")).toBe("Shipped today");
  });

  it("turns dashes into a comma pause and arrows into 'to'", () => {
    expect(toSpeech("Fast \u2014 and light")).toBe("Fast, and light");
    expect(toSpeech("A \u2013 B")).toBe("A, B");
    expect(toSpeech("input -> output")).toBe("input to output");
    expect(toSpeech("input \u2192 output")).toBe("input to output");
  });

  it("spells angle brackets so the API never sees markup", () => {
    const out = toSpeech("List<string> and a < b");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("less than");
  });

  it("collapses whitespace and tidies spacing before punctuation", () => {
    expect(toSpeech("  one   two \n three  ,  four ")).toBe("one two three, four");
  });

  it("never changes digits or the words around the rewrites", () => {
    const input =
      "Springlet v2.0 cuts 35% of frames in R&D; see 12 demos w/o setup, e.g. Safari 26.1";
    const out = toSpeech(input);
    for (const token of ["35%", "12", "Springlet", "Safari", "frames", "demos", "setup"]) {
      expect(out).toContain(token);
    }
  });

  it("is idempotent", () => {
    const samples = [
      "R&D and client/server, v4 vs. v3, e.g. 1.2.3 etc.",
      "# Heading with [link](https://x.example) and **bold** \u2014 dash \u2192 arrow",
      "List<string> w/o w/ approx. 24/7 and/or",
      "Plain sentence with nothing to change.",
    ];
    for (const sample of samples) expect(toSpeech(toSpeech(sample))).toBe(toSpeech(sample));
  });

  it("returns an empty string for text that is only a URL", () => {
    expect(toSpeech("https://example.com/only")).toBe("");
  });
});
