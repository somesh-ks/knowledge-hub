import { describe, expect, it } from "vitest";
import {
  episodeHighlights,
  HIGHLIGHT_CHARS,
  publisherOf,
  spokenSummary,
  trimAtSentence,
} from "./episodeHighlights";

const source = (item_id: string, url = `https://www.${item_id}.com/story`) => ({
  item_id,
  url,
  headline: `Headline ${item_id}`,
  source: "Exa discovery",
});
const turn = (idx: number, text: string, item_id: string | null) => ({
  idx,
  speaker: "a" as const,
  text,
  item_id,
});

describe("trimAtSentence", () => {
  it("leaves a short text alone", () => {
    expect(trimAtSentence("One. Two.")).toBe("One. Two.");
  });

  it("cuts at the last sentence end that fits", () => {
    const text = `${"First sentence. ".repeat(10)}Tail goes on and on without end`.padEnd(400, "x");
    const out = trimAtSentence(text);
    expect(out.length).toBeLessThanOrEqual(HIGHLIGHT_CHARS);
    expect(out.endsWith("sentence.")).toBe(true);
  });

  it("stops at a word, with an ellipsis, when there is one long sentence", () => {
    const out = trimAtSentence("word ".repeat(100));
    expect(out.length).toBeLessThanOrEqual(HIGHLIGHT_CHARS + 1);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("episodeHighlights", () => {
  const episode = {
    sources: [source("a"), source("b"), source("c", "not a url")],
    turns: [
      turn(0, "This is Singularity.", null),
      turn(1, "Host: Story B first.", "b"),
      turn(2, "More on B.", "b"),
      turn(3, "Even more on B.", "b"),
      turn(4, "Story A now.", "a"),
    ],
  };

  it("lists stories in the order they are discussed, unspoken ones last", () => {
    expect(episodeHighlights(episode).map((h) => h.itemId)).toEqual(["b", "a", "c"]);
  });

  it("takes one turn of a story, without speaker labels", () => {
    const [b, a, c] = episodeHighlights(episode);
    expect(b?.text).toBe("Story B first.");
    expect(a?.text).toBe("Story A now.");
    expect(c?.text).toBe("");
  });

  it("carries the bare host, and no link for an address that is not a web url", () => {
    const [b, , c] = episodeHighlights(episode);
    expect(b?.host).toBe("b.com");
    expect(c?.host).toBeNull();
  });
});

// The shapes of the real episodes under Podcasts/2026/10: a host's segue, then the headline said
// again, then what is new; the publisher stored beside an aggregator's name.
describe("highlights from a real script", () => {
  const real = {
    sources: [
      {
        item_id: "7dbe6e38bd36",
        url: "http://www.lmnt.cn/news/274338",
        headline: "Open Design Modern package uses DESIGN.md and tokens.css",
        source: "Exa discovery",
      },
      {
        item_id: "04f819a38428",
        url: "https://github.com/shadcn-ui/ui/releases/tag/x",
        headline: "@shadcn/registry@0.1.3 loads ts-morph only for writes",
        source: "shadcn/ui",
      },
      {
        item_id: "q1",
        url: "https://example.com/quiet",
        headline: "Why a quiet interface needs one loud detail",
        source: "Margin Notes",
      },
    ],
    turns: [
      { idx: 0, speaker: "a" as const, text: "This is Singularity." },
      {
        idx: 1,
        speaker: "b" as const,
        text: "Today's top story: the Modern design system uses DESIGN.md and tokens.css.",
        item_id: "7dbe6e38bd36",
      },
      {
        idx: 2,
        speaker: "a" as const,
        text: "It separates design intent in DESIGN.md from implementation in tokens.css. Semantic tokens compile to Tailwind v4.",
        item_id: "7dbe6e38bd36",
      },
      {
        idx: 3,
        speaker: "a" as const,
        text: "Next, @shadcn/registry@0.1.3 now loads ts-morph only for writes.",
        item_id: "04f819a38428",
      },
      {
        idx: 4,
        speaker: "b" as const,
        text: "Does that reduce bundle size for read-only use?",
        item_id: "04f819a38428",
      },
      {
        idx: 5,
        speaker: "a" as const,
        text: "Start with emphasis. An essay argues that a quiet screen is allowed one loud detail.",
        item_id: "q1",
      },
    ],
  };

  it("drops segues and a headline said again, and keeps one turn", () => {
    const [design, , quiet] = episodeHighlights(real);
    expect(design?.text).toBe(
      "It separates design intent in DESIGN.md from implementation in tokens.css. Semantic tokens compile to Tailwind v4.",
    );
    expect(quiet?.text).toBe("An essay argues that a quiet screen is allowed one loud detail.");
  });

  it("uses the briefing's summary for a story that is in a briefing", () => {
    const summaries = new Map([["04f819a38428", "The registry no longer loads ts-morph to read."]]);
    const [, registry] = episodeHighlights(real, summaries);
    expect(registry?.text).toBe("The registry no longer loads ts-morph to read.");
  });

  it("names the publisher, and the host only for an aggregator", () => {
    const [design, registry, quiet] = episodeHighlights(real);
    expect(design?.publisher).toBe("lmnt.cn");
    expect(registry?.publisher).toBe("shadcn/ui");
    expect(quiet?.publisher).toBe("Margin Notes");
    expect(publisherOf("Hacker News", "example.com")).toBe("example.com");
  });

  it("drops a lead-in from a sentence it keeps, and starts it with a capital", () => {
    expect(
      spokenSummary("Next, a rig counts frames between a touch and a pixel.", "Tap latency"),
    ).toBe("A rig counts frames between a touch and a pixel.");
  });

  it("keeps a lone short sentence that is not a segue", () => {
    expect(spokenSummary("It ships today.", "Something else entirely")).toBe("It ships today.");
  });

  it("does not take a host's question for the highlight: the answer is", () => {
    // The real discussion (ep-20261008-1155) opens most stories with the other host asking.
    expect(
      spokenSummary("What does that enable?", "Amazon Style Dictionary integrates with Tailwind"),
    ).toBe("");
    expect(
      spokenSummary(
        "Why does that matter? Tokens compile once and ship to every platform.",
        "Amazon Style Dictionary integrates with Tailwind",
      ),
    ).toBe("Tokens compile once and ship to every platform.");
    const episode = {
      sources: [
        {
          item_id: "a",
          headline: "Amazon Style Dictionary integrates with Tailwind",
          url: "https://example.com/a",
          source: "Exa discovery",
        },
      ],
      turns: [
        { idx: 0, speaker: "b" as const, text: "What does that enable?", item_id: "a" },
        {
          idx: 1,
          speaker: "a" as const,
          text: "Tokens compile once and ship to every platform.",
          item_id: "a",
        },
      ],
    };
    expect(episodeHighlights(episode)[0]?.text).toBe(
      "Tokens compile once and ship to every platform.",
    );
  });
});
