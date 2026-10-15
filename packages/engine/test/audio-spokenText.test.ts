import type { Digest, Section } from "@dispatch/core";
import { SECTIONS, VOICE_LIMITS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { bridgeCandidates } from "../src/audio/hostFrame.js";
import {
  buildSpokenText,
  itemBlock,
  MAX_SPOKEN_CHARS,
  SpokenTextError,
  SpokenTextTooLongError,
  toSpeech,
} from "../src/audio/spokenText.js";
import { countWords } from "../src/voice/sentences.js";
import { makeDigest, makeItem, makeStory, must } from "./audio-fixtures.js";

function digestWith(sections: Section[], overrides: Partial<Digest> = {}): Digest {
  return makeDigest({
    ...overrides,
    items: sections.map((section, index) => makeItem(index, { section })),
  });
}

describe("buildSpokenText opening line", () => {
  it("names the product, the day as a person says it, and the count as a word", () => {
    const text = buildSpokenText(makeDigest({}, 11)).text;
    expect(
      text.startsWith(
        "This is Singularity for Wednesday the seventh of October. Eleven stories today, starting with the top picks.",
      ),
    ).toBe(true);
  });

  it.each([
    [3, "Three stories today"],
    [8, "Eight stories today"],
    [12, "Twelve stories today"],
    [17, "Seventeen stories today"],
    [18, "Eighteen stories today"],
    [19, "Nineteen stories today"],
    [20, "Twenty stories today"],
    [21, "Twenty-one stories today"],
    [23, "Twenty-three stories today"],
    [24, "Twenty-four stories today"],
  ])("spells %i as a word", (count, expected) => {
    expect(buildSpokenText(makeDigest({}, count)).text).toContain(expected);
  });

  it("says 'One story' for a single story", () => {
    expect(buildSpokenText(makeDigest({}, 1)).text).toContain(
      "This is Singularity for Wednesday the seventh of October. One story today",
    );
  });

  it("falls back to digits above twenty-four, the most a digest can hold", () => {
    expect(buildSpokenText(makeDigest({}, 25)).text).toContain("25 stories today");
  });

  it("names the weekly pass and the special edition, with the greeting chosen by kind not clock", () => {
    const weekly = buildSpokenText(
      makeDigest({ kind: "weekly", id: "2026-10-11-weekly", date: "2026-10-11" }, 4),
    ).text;
    expect(
      weekly.startsWith(
        "This is the Singularity weekly, for Sunday the eleventh of October. Four stories from the week, starting with the top picks.",
      ),
    ).toBe(true);
    const onDemand = buildSpokenText(makeDigest({ kind: "on-demand" }, 4)).text;
    expect(
      onDemand.startsWith("This is Singularity, a special edition for Wednesday the seventh"),
    ).toBe(true);
    for (const text of [weekly, onDemand])
      expect(text).not.toMatch(/good (morning|evening|afternoon)/i);
  });

  it("starts with the section the briefing actually opens on", () => {
    const text = buildSpokenText(digestWith(["research", "research", "research"])).text;
    expect(text).toContain("Three stories today, starting with research.");
  });

  it("never says the old product name or calls a story an item", () => {
    for (const kind of ["regular", "weekly", "on-demand"] as const) {
      const opening = buildSpokenText(makeDigest({ kind }, 5)).text.split("\n")[0] ?? "";
      expect(opening).not.toContain("Dispatch");
      expect(opening).not.toMatch(/\bitems?\b/);
    }
  });
});

describe("buildSpokenText without a why line", () => {
  it("narrates the headline and the four-beat summary, and ends on the summary", () => {
    const digest = makeDigest({ items: [makeStory(0), makeStory(1), makeStory(2)] });
    const { text, ranges } = buildSpokenText(digest);
    for (const range of ranges) {
      const item = must(digest.items.find((candidate) => candidate.id === range.id));
      expect(item).not.toHaveProperty("why");
      // A story after the first of its section may carry a short connective in front.
      expect(text.slice(range.start, range.end).endsWith(`${item.headline}. ${item.summary}`)).toBe(
        true,
      );
    }
    expect(text).toContain(must(digest.items.at(-1)).summary);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("Copy the pattern");
  });

  // A telling the voice check removed fell back to "ttok 1.0 defaults to GPT-5 tokenizer. ttok 1.0
  // defaults to the GPT-5 tokenizer family...", the news read twice in a row.
  it("leaves out a headline the summary opens by restating", () => {
    const summary =
      "ttok 1.0 defaults to the GPT-5 tokenizer family instead of GPT-4. An experiment found matching counts.";
    const story = makeStory(0, { headline: "ttok 1.0 defaults to GPT-5 tokenizer", summary });
    expect(itemBlock(story)).toBe(summary);
    expect(itemBlock(makeStory(1))).toContain(makeStory(1).headline);
  });

  it("keeps exact ranges when stories with and without a why line are mixed", () => {
    const digest = makeDigest({
      items: [makeItem(0), makeStory(1), makeItem(2), makeStory(3), makeStory(4)],
    });
    const { text, ranges } = buildSpokenText(digest);
    expect(ranges).toHaveLength(5);
    for (const range of ranges) {
      const item = must(digest.items.find((candidate) => candidate.id === range.id));
      const block = text.slice(range.start, range.end);
      expect(block).toContain(`${item.headline}. ${item.summary}`);
      expect(block.endsWith(item.why ? `${item.why}.` : item.summary)).toBe(true);
    }
  });

  it("treats a why of undefined the same as no why", () => {
    const digest = makeDigest({
      items: [makeItem(0, { why: undefined }), makeStory(1), makeStory(2)],
    });
    const first = must(buildSpokenText(digest).ranges[0]);
    const item = must(digest.items[0]);
    expect(buildSpokenText(digest).text.slice(first.start, first.end)).toBe(
      `${item.headline}. ${item.summary}`,
    );
    // The first story of the briefing opens its section, so nothing comes before it.
  });

  it("fits twenty-four stories at the full summary length inside the character limit", () => {
    const longest = Array.from({ length: 80 }, (_, i) => (i % 20 === 19 ? "wordy." : "wordy")).join(
      " ",
    );
    const digest = makeDigest({
      items: Array.from({ length: 24 }, (_, index) => makeStory(index, { summary: longest })),
    });
    const { text } = buildSpokenText(digest);
    expect(text.startsWith("This is Singularity for Wednesday the seventh of October.")).toBe(true);
    expect(text).toContain("Twenty-four stories today");
    expect(text.length).toBeLessThan(MAX_SPOKEN_CHARS);
  });
});

describe("buildSpokenText structure", () => {
  it("bridges into each section after the first, in section order, with no bridge before the first", () => {
    const digest = digestWith(["ai", "top", "research", "ui-craft", "top"]);
    const { text, sectionStarts } = buildSpokenText(digest);
    expect(sectionStarts.map((section) => section.slug)).toEqual([
      "top",
      "ui-craft",
      "ai",
      "research",
    ]);
    const [first, ...later] = sectionStarts;
    // The opening already said "starting with the top picks": the first story follows at once.
    expect(text.slice(must(first).start)).toMatch(/^Headline number 2\./);
    for (const section of later) {
      const sentence = /^[^\n]+/.exec(text.slice(section.start))?.[0] ?? "";
      expect(bridgeCandidates(section.slug, 1)).toContain(sentence);
    }
  });

  it("never says the same bridge twice in a row, and says the same thing every time it is built", () => {
    for (const id of [
      "2026-10-07",
      "2026-10-09",
      "2026-10-11-weekly",
      "2026-11-01",
      "2026-12-24",
    ]) {
      const digest = digestWith([...SECTIONS], { id, kind: "regular" });
      const build = (): string[] => {
        const { text, sectionStarts } = buildSpokenText(digest);
        return sectionStarts.slice(1).map((s) => /^[^\n]+/.exec(text.slice(s.start))?.[0] ?? "");
      };
      const bridges = build();
      expect(bridges).toHaveLength(SECTIONS.length - 1);
      bridges.forEach((bridge, index) => {
        if (index > 0) expect(bridge).not.toBe(bridges[index - 1]);
      });
      expect(build()).toEqual(bridges);
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
      expect(block).toContain(`${item.headline}. ${item.summary}`);
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

  it("places each section start before that section's first item, and at it for the first section", () => {
    const { ranges, sectionStarts } = buildSpokenText(makeDigest({}, 12));
    sectionStarts.forEach((section, index) => {
      const first = must(ranges.find((range) => range.section === section.slug));
      if (index === 0) expect(section.start).toBe(first.start);
      else expect(section.start).toBeLessThan(first.start);
    });
  });

  it("ends with the sign-off after the last item, and the item range stops before it", () => {
    const digest = makeDigest({}, 5);
    const { text, ranges } = buildSpokenText(digest);
    expect(text.endsWith("\n\nThat's the briefing. More in two days.")).toBe(true);
    const last = must(ranges.at(-1));
    expect(text.slice(last.end)).toBe("\n\nThat's the briefing. More in two days.");
    expect(text.slice(last.start, last.end).endsWith(`${must(digest.items.at(-1)).why}.`)).toBe(
      true,
    );
  });

  it("signs off a weekly and a special edition in their own words", () => {
    expect(
      buildSpokenText(makeDigest({ kind: "weekly" }, 5)).text.endsWith(
        "That's the weekly briefing. Back next week.",
      ),
    ).toBe(true);
    const onDemand = buildSpokenText(makeDigest({ kind: "on-demand" }, 5)).text;
    expect(onDemand.endsWith("That's the briefing.")).toBe(true);
    expect(onDemand).not.toContain("More in two days");
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

  it("ends a field that trails off with a colon or comma as a sentence, not as ':.'", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, { headline: "Three measures for agent UIs:", why: "Copy the first one," }),
        makeItem(1),
        makeItem(2),
      ],
    });
    const { text } = buildSpokenText(digest);
    expect(text).toContain("Three measures for agent UIs. ");
    expect(text).toContain("Copy the first one.");
    expect(text).not.toMatch(/[:,]\./);
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

  it("introduces every section: the opening names the first, a bridge names each later one", () => {
    const { text, sectionStarts } = buildSpokenText(digestWith([...SECTIONS]));
    expect(text).toContain("starting with the top picks");
    expect(sectionStarts).toHaveLength(SECTIONS.length);
    for (const section of sectionStarts.slice(1)) {
      const sentence = /^[^\n]+/.exec(text.slice(section.start))?.[0] ?? "";
      expect(bridgeCandidates(section.slug, 1)).toContain(sentence);
    }
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

  it.each([
    [
      "markdown, keeping link labels",
      "# Title\n- a **bold** [link](https://x.example/p) and `code`",
      "Title a bold link and code",
    ],
    ["a bare URL", "Visit www.example.com now", "Visit now"],
    [
      "an image, keeping its label",
      "Read ![diagram](https://x.example/d.png) first",
      "Read diagram first",
    ],
    ["text that is only a URL", "https://example.com/only", ""],
    ["a URL before a closing parenthesis", "(see https://x.example/a) sharply", "(see) sharply"],
    ["a URL before a comma", "Docs at https://x.example/a, then more", "Docs at, then more"],
    ["emoji and variation selectors", "Shipped \u{1F680} today \u2764\uFE0F", "Shipped today"],
    ["an em dash as a pause", "Fast \u2014 and light", "Fast, and light"],
    ["a spaced en dash as a pause", "A \u2013 B", "A, B"],
    ["an ASCII arrow", "input -> output", "input to output"],
    ["a Unicode arrow", "input \u2192 output", "input to output"],
    [
      "en dash ranges between numbers",
      "$5\u201310M in 2020\u20132024",
      "$5 to 10M in 2020 to 2024",
    ],
    ["a spaced en dash range", "10M \u2013 $20M", "10M to $20M"],
    ["a spaced en dash between plain numbers", "5 \u2013 10 items", "5 to 10 items"],
    ["a dash after a full stop", "It shipped. \u2014 Next up", "It shipped. Next up"],
    ["a dash after a question mark", "Really? \u2013 Yes", "Really? Yes"],
    ["HTML entities", "a &lt; b &amp;&amp; c &gt; d", "a less than b and and c greater than d"],
    ["a non-breaking space entity", "one&nbsp;two", "one two"],
    ["a leading comparison, not a quote marker", "> $1B raised", "greater than $1B raised"],
    ["an astral letter", "\u{1D54F} launches Grok", "X launches Grok"],
    ["astral digits", "\u{1D7D9}\u{1D7DA} items", "12 items"],
    ["an astral symbol", "a \u{1F3A8} b", "a b"],
    [
      "extra whitespace and space before punctuation",
      "  one   two \n three  ,  four ",
      "one two three, four",
    ],
  ])("rewrites %s", (_name, input, expected) => {
    expect(toSpeech(input)).toBe(expected);
  });

  it("spells angle brackets so the API never sees markup", () => {
    const out = toSpeech("List<string> and a < b");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("less than");
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
});

/** A telling of about 70 words, the length a typical story runs to. */
const TYPICAL_TELLING =
  "Google has a new Pixel, and the headline feature is the screen. It's brighter than last year's, and it stays readable in direct sun. The phone goes on sale next month at 799 dollars, the same price as before. The catch: the faster charging only works with Google's own charger, which is sold separately, so check the box before you count on it.";

describe("buildSpokenText with a spoken version", () => {
  it("reads the spoken version alone, without the headline, the summary or the why line", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, { spoken: "Springlet has a new release, and it keeps velocity." }),
        makeStory(1),
        makeStory(2),
      ],
    });
    const { text, ranges } = buildSpokenText(digest);
    const first = must(ranges[0]);
    expect(text.slice(first.start, first.end)).toBe(
      "Springlet has a new release, and it keeps velocity.",
    );
    expect(text).not.toContain("Headline number 1");
    expect(text).not.toContain("Copy the pattern from item 1");
  });

  it("falls back to the headline and the summary for a story without one, in the same briefing", () => {
    const digest = makeDigest({
      items: [
        makeStory(0, { spoken: "A spoken story. It has two sentences." }),
        makeStory(1),
        makeStory(2),
      ],
    });
    const { text } = buildSpokenText(digest);
    expect(text).toContain("A spoken story. It has two sentences.");
    expect(text).toContain("Headline number 2. Story 2 ships");
  });

  it("normalizes the spoken text like any other field", () => {
    const digest = makeDigest({
      items: [
        makeStory(0, { spoken: "It costs **799** dollars at https://example.com/buy and no more" }),
        makeStory(1),
        makeStory(2),
      ],
    });
    const { text, ranges } = buildSpokenText(digest);
    const first = must(ranges[0]);
    expect(text.slice(first.start, first.end)).toBe("It costs 799 dollars at and no more.");
  });
});

describe("buildSpokenText connectives between stories", () => {
  const stories = (count: number) =>
    makeDigest({
      items: Array.from({ length: count }, (_, index) => makeStory(index, { section: "ai" })),
    });

  it("puts none before the first story of a section and may put one before the rest", () => {
    const digest = stories(8);
    const { text, ranges } = buildSpokenText(digest);
    const first = must(ranges[0]);
    const item = must(digest.items.find((candidate) => candidate.id === first.id));
    expect(text.slice(first.start, first.end)).toBe(`${item.headline}. ${item.summary}`);
    const connectives = ranges.slice(1).map((range) => {
      const block = text.slice(range.start, range.end);
      const story = must(digest.items.find((candidate) => candidate.id === range.id));
      return block.slice(0, block.length - `${story.headline}. ${story.summary}`.length).trim();
    });
    expect(connectives.some((connective) => connective !== "")).toBe(true);
    expect(connectives.some((connective) => connective === "")).toBe(true);
    for (const connective of connectives) expect(connective.length).toBeLessThan(20);
  });

  it("never repeats a connective back to back, and is the same on every build", () => {
    const digest = stories(24);
    const build = (): string[] => {
      const { text, ranges } = buildSpokenText(digest);
      return ranges.map((range) => text.slice(range.start, range.end).split(". ")[0] ?? "");
    };
    const heads = build();
    const connected = heads.filter((head) => !head.startsWith("Headline number"));
    expect(connected.length).toBeGreaterThan(0);
    heads.forEach((head, index) => {
      if (index > 0 && !head.startsWith("Headline number")) expect(head).not.toBe(heads[index - 1]);
    });
    expect(build()).toEqual(heads);
  });

  it("says 'Also this week' only in a weekly", () => {
    const weekly = makeDigest({
      kind: "weekly",
      id: "2026-10-11-weekly",
      date: "2026-10-11",
      items: Array.from({ length: 24 }, (_, index) => makeStory(index, { section: "ai" })),
    });
    expect(buildSpokenText(weekly).text).toContain("Also this week.");
    expect(buildSpokenText(stories(24)).text).not.toContain("Also this week.");
    expect(buildSpokenText(stories(24)).text).toContain("Also today.");
  });
});

describe("buildSpokenText keeps the host frame out of the page", () => {
  it("adds nothing to the digest: the frame exists only in the narration text", () => {
    const digest = makeDigest({}, 8);
    const before = JSON.stringify(digest);
    const { text } = buildSpokenText(digest);
    expect(JSON.stringify(digest)).toBe(before);
    expect(text).toContain("This is Singularity");
    expect(JSON.stringify(digest)).not.toContain("This is Singularity");
    expect(JSON.stringify(digest)).not.toContain("More in two days");
  });
});

describe("how long a full briefing runs", () => {
  /** 62 ms per character: the rate Speechify's narration has measured in this product. */
  const MS_PER_CHAR = 62;
  const minutes = (chars: number): number => (chars * MS_PER_CHAR) / 60_000;

  /** The longest telling the lint lets through: the character ceiling, ending on a full stop. */
  function longestTelling(): string {
    return `${"abcdefgh "
      .repeat(80)
      .slice(0, VOICE_LIMITS.spokenChars - 1)
      .trimEnd()}.`;
  }

  const SECTION_CYCLE: Section[] = ["top", "ui-craft", "ai", "research", "launches", "watch"];

  /** `count` stories: up to twelve in the main sections, the rest in Tech releases. */
  function fullDigest(count: number, spoken: string): Digest {
    const sections = Array.from(
      { length: count },
      (_, index): Section => (index < 12 ? (SECTION_CYCLE[index % 6] as Section) : "tech"),
    );
    return makeDigest({
      items: sections.map((section, index) => makeStory(index, { section, spoken })),
    });
  }

  it("stays under the request limit at the longest the lint allows, even for 24 stories", () => {
    const longest = longestTelling();
    expect(longest.length).toBeLessThanOrEqual(VOICE_LIMITS.spokenChars);
    for (const count of [17, 24]) {
      const { text } = buildSpokenText(fullDigest(count, longest));
      expect(text.length).toBeLessThan(MAX_SPOKEN_CHARS);
    }
    // 12 stories plus 5 tech, every telling at its ceiling: the worst case for a regular digest.
    expect(minutes(buildSpokenText(fullDigest(17, longest)).text.length)).toBeLessThan(13);
  });

  it("runs under seven minutes for a typical 14-story briefing, well under ten", () => {
    expect(countWords(TYPICAL_TELLING)).toBeGreaterThanOrEqual(VOICE_LIMITS.spokenMinWords);
    expect(countWords(TYPICAL_TELLING)).toBeLessThanOrEqual(VOICE_LIMITS.spokenWords);
    const { text } = buildSpokenText(fullDigest(14, TYPICAL_TELLING));
    expect(text.length).toBeGreaterThan(5_000);
    expect(minutes(text.length)).toBeGreaterThan(4);
    expect(minutes(text.length)).toBeLessThan(10);
  });
});
