import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_LIMITS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { createLinter, lint } from "../src/voice/lint.js";
import {
  countSentences,
  countWords,
  longSentences,
  splitSentences,
} from "../src/voice/sentences.js";
import { parseVoice, type VoiceConfig } from "../src/voice/voice.js";
import { REPO_ROOT } from "./score-factories.js";

const voiceMd = readFileSync(join(REPO_ROOT, "config", "voice.md"), "utf8");
const voice: VoiceConfig = parseVoice(voiceMd);
const linter = createLinter(voice);

const rules = (field: "headline" | "summary" | "why", text: string): string[] =>
  linter.lint(field, text).map((v) => v.rule);

describe("parseVoice", () => {
  it("reads the banned words and patterns from config/voice.md", () => {
    expect(voice.bannedWords).toContain("game-changing");
    expect(voice.bannedWords).toContain("it's worth noting");
    expect(voice.bannedWords.length).toBeGreaterThanOrEqual(29);
    expect(voice.bannedPatterns.length).toBe(6);
    expect(voice.bannedPatterns[0]?.source).toBe("^\\s*(here'?s|check out|take a look)\\b");
  });

  it("reads principles, limits and the weak versus strong examples", () => {
    expect(voice.principles).toHaveLength(7);
    expect(voice.principles[0]).toMatch(/^Four beats, in order\./);
    expect(voice.limits.some((line) => line.startsWith("Headline: at most 12 words"))).toBe(true);
    expect(voice.examples).toHaveLength(3);
    expect(voice.examples[0]?.strong).toContain("Springlet 2.0");
    expect(voice.examples[1]?.strong).toContain("Sonos launched the Ace Ultra");
  });

  it("states the same limits in prose as the code enforces", () => {
    const limits = voice.limits.join("\n");
    expect(limits).toContain(`Headline: at most ${VOICE_LIMITS.headlineWords} words.`);
    expect(limits).toContain(`45 to ${VOICE_LIMITS.summaryWords} words`);
    expect(limits).toContain("three or four sentences");
    expect(limits).toContain("Two sentences are accepted when the source is thin.");
    expect(limits).toContain(`No sentence longer than ${VOICE_LIMITS.sentenceWords} words.`);
    expect(VOICE_LIMITS.summarySentences).toBe(4);
    expect(VOICE_LIMITS.summaryMinSentences).toBe(2);
    // No why line is described any more: the fourth beat lives in the summary.
    expect(voiceMd).not.toMatch(/^- Why:/m);
    expect(voiceMd.startsWith("# Singularity voice\n")).toBe(true);
  });

  it("rejects a file with no banned words", () => {
    expect(() => parseVoice("## Banned patterns\n\n- foo\n")).toThrow(/Banned words/);
  });

  it("rejects a file with no banned patterns", () => {
    expect(() => parseVoice("## Banned words\n\n- foo\n")).toThrow(/Banned patterns/);
  });

  it("names the pattern that fails to compile", () => {
    expect(() =>
      parseVoice("## Banned words\n\n- foo\n\n## Banned patterns\n\n- (unclosed\n"),
    ).toThrow(/Invalid banned pattern "\(unclosed"/);
  });

  it("accepts CRLF line endings and backtick-wrapped patterns", () => {
    const config = parseVoice(
      "## Banned words\r\n\r\n- foo\r\n\r\n## Banned patterns\r\n\r\n- `bar+`\r\n",
    );
    expect(config.bannedWords).toEqual(["foo"]);
    expect(config.bannedPatterns[0]?.source).toBe("bar+");
  });
});

describe("banned words", () => {
  it.each(voice.bannedWords)("flags %s", (word) => {
    const found = rules("summary", `This release is ${word} for teams.`);
    expect(found).toContain("banned_word");
  });

  it("matches whole words only", () => {
    // Headlines have no lower bound, so a clean one lints to nothing at all.
    expect(rules("headline", "Robustness tests cover the popular drawer")).toEqual([]);
    expect(rules("summary", "Landscaping is out of scope for the drawer.")).toContain(
      "banned_word",
    );
    expect(rules("headline", "The hug gesture closes the drawer")).toEqual([]);
    expect(rules("summary", "Robustness tests cover the popular drawer.")).not.toContain(
      "banned_word",
    );
    expect(rules("summary", "The hug gesture closes the drawer.")).not.toContain("banned_word");
  });

  it("is case-insensitive", () => {
    expect(rules("headline", "Revolutionary springs ship")).toContain("banned_word");
    expect(rules("headline", "GAME-CHANGING springs ship")).toContain("banned_word");
  });

  it("catches regular inflections of single words", () => {
    expect(rules("summary", "The library unlocks faster drawers.")).toContain("banned_word");
    expect(rules("summary", "Teams leveraging the API ship sooner.")).toContain("banned_word");
    expect(rules("summary", "It delved into the source.")).toContain("banned_word");
  });

  it("catches adverbs, plurals and spaced or hyphenated spellings of an entry", () => {
    for (const text of [
      "It works seamlessly now.",
      "A robustly tested drawer.",
      "Amazingly, springs retarget.",
      "The release is hugely popular.",
      "Both are game-changers for teams.",
      "A game changer for drawers.",
      "Two deep dives into springs.",
      "Massively faster drawers.",
    ]) {
      expect(rules("summary", text)).toContain("banned_word");
    }
  });

  it("escapes regex characters in a banned entry instead of throwing or over-matching", () => {
    const config = parseVoice(
      "## Banned words\n\n- c++\n- e.g.\n- (beta)\n- -\n\n## Banned patterns\n\n- zzz\n",
    );
    const custom = createLinter(config);
    const flagged = (text: string): boolean =>
      custom.lint("summary", text).some((v) => v.rule === "banned_word");
    expect(flagged("Written in C++ for speed.")).toBe(true);
    expect(flagged("Springs, e.g. for drawers.")).toBe(true);
    expect(flagged("A (beta) release.")).toBe(true);
    expect(flagged("A cxx release and eXg notes.")).toBe(false);
    // The entry made only of a separator must not match everywhere.
    expect(flagged("Plain text with nothing banned.")).toBe(false);
  });

  it("matches multi-word phrases across curly apostrophes", () => {
    expect(rules("summary", "In today\u2019s tooling, drawers lag.")).toContain("banned_word");
    expect(rules("summary", "A deep   dive into springs.")).toContain("banned_word");
  });

  it("reports the matched text and position", () => {
    const [violation] = linter.lint("summary", "Springs feel seamless now.");
    expect(violation).toMatchObject({ rule: "banned_word", match: "seamless", index: 13 });
    expect(violation?.message).toContain("seamless");
  });
});

describe("banned patterns and punctuation", () => {
  it.each([
    ["Here's how springs work", "banned_pattern"],
    ["Check out the new drawer", "banned_pattern"],
    ["Take a look at springs", "banned_pattern"],
    ["The drawer is not just fast but also smooth", "banned_pattern"],
    ["You should retarget springs mid-flight", "banned_pattern"],
    ["You can now retarget springs", "banned_pattern"],
  ])("flags %s", (text, rule) => {
    expect(rules("summary", text)).toContain(rule);
  });

  it("flags a rhetorical question", () => {
    expect(rules("headline", "Why do springs feel better?")).toContain("question");
  });

  it("flags em and en dashes once each", () => {
    const found = rules("summary", "Springs \u2014 and drawers \u2013 ship.");
    expect(found.filter((r) => r === "dash")).toHaveLength(2);
    expect(found).not.toContain("banned_pattern");
  });

  it("flags a spaced double hyphen used as a dash", () => {
    expect(rules("summary", "Springs -- and drawers ship.")).toContain("dash");
  });

  it("flags exclamation marks without a duplicate pattern hit", () => {
    const found = rules("headline", "Springs ship!");
    expect(found).toEqual(["exclamation"]);
  });

  it("flags emoji, including variation-selector and flag forms", () => {
    expect(rules("headline", "Springs ship \u{1F680}")).toContain("emoji");
    expect(rules("headline", "Springs \u2764\uFE0F drawers")).toContain("emoji");
    expect(rules("headline", "Springs \u{1F1F8}\u{1F1EA}")).toContain("emoji");
  });

  it("does not flag trademark signs or arrows as emoji", () => {
    expect(rules("headline", "Springlet\u2122 maps input \u2192 output")).toEqual([]);
  });
});

describe("markdown and links", () => {
  it.each([
    ["See [the post](https://example.com/a)", "link"],
    ["Details at https://example.com/a", "link"],
    ["Details at www.example.com", "link"],
    ["Use `useSpring` for this", "markdown"],
    ["A **bold** claim", "markdown"],
    ["An *italic* claim", "markdown"],
    ["# Heading", "markdown"],
    ["- bullet item", "markdown"],
    ["1. numbered item", "markdown"],
    ["> quoted text", "markdown"],
    ["Wrap in <b>tags</b> here", "markdown"],
  ])("flags %s", (text, rule) => {
    expect(rules("summary", text)).toContain(rule);
  });

  it("leaves ordinary technical text alone", () => {
    expect(rules("headline", "Next.js 16 adds useSpring_ref and a 2.0 build of Three.js")).toEqual(
      [],
    );
    expect(rules("headline", "Snake_case names and 3 * 4 products stay as they are")).toEqual([]);
    expect(
      rules(
        "summary",
        "Next.js 16 adds useSpring_ref and a 2.0 build of Three.js for teams that render drawers on the server. Snake_case names and 3 * 4 products stay as they are in the generated code.",
      ),
    ).toEqual([]);
  });
});

describe("limits", () => {
  const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  /** A summary made of sentences with the given word counts. */
  const prose = (...counts: number[]): string => counts.map((n) => `${words(n)}.`).join(" ");

  it("allows a 12-word headline and flags 13", () => {
    expect(rules("headline", words(12))).toEqual([]);
    expect(rules("headline", words(13))).toEqual(["too_many_words"]);
  });

  it("allows an 80-word summary and flags 81", () => {
    expect(rules("summary", prose(20, 20, 20, 20))).toEqual([]);
    expect(rules("summary", prose(20, 20, 20, 21))).toEqual(["too_many_words"]);
  });

  it("allows a 25-word summary and flags 24", () => {
    expect(rules("summary", prose(12, 13))).toEqual([]);
    expect(rules("summary", prose(12, 12))).toEqual(["too_few_words"]);
    const [violation] = linter.lint("summary", prose(12, 12));
    expect(violation?.message).toBe("The summary has 24 words; it needs at least 25.");
  });

  it("allows a 28-word sentence in a summary and flags 29", () => {
    expect(rules("summary", prose(28, 10))).toEqual([]);
    expect(rules("summary", prose(10, 29, 10))).toEqual(["sentence_too_long"]);
    const [violation] = linter.lint("summary", prose(10, 29, 10));
    expect(violation?.match).toBe(`${words(29)}.`);
    // The sentence came from the source, so it travels in `match` and never in the message.
    expect(violation?.message).toBe(
      "A sentence in the summary has 29 words; split it so no sentence runs past 28.",
    );
    expect(rules("summary", prose(29, 30))).toEqual(["sentence_too_long", "sentence_too_long"]);
  });

  it("holds the sentence cap and the lower bounds to the summary only", () => {
    expect(rules("headline", words(3))).toEqual([]);
    expect(rules("why", `${words(3)}.`)).toEqual([]);
    expect(longSentences(prose(28, 29, 5), 28).map((s) => s.words)).toEqual([29]);
  });

  it("allows an 18-word why and flags 19", () => {
    expect(rules("why", `${words(18)}.`)).toEqual([]);
    expect(rules("why", `${words(19)}.`)).toEqual(["too_many_words"]);
  });

  it("allows two to four summary sentences and flags one or five", () => {
    expect(rules("summary", prose(13, 13))).toEqual([]);
    expect(rules("summary", prose(13, 13, 13))).toEqual([]);
    expect(rules("summary", prose(13, 13, 13, 13))).toEqual([]);
    expect(rules("summary", prose(13, 13, 13, 13, 13))).toEqual(["too_many_sentences"]);
    expect(rules("summary", prose(26))).toEqual(["too_few_sentences"]);
    const [violation] = linter.lint("summary", prose(26));
    expect(violation?.message).toBe("The summary has 1 sentence; it needs at least 2.");
  });

  it("reports a single short sentence on both lower bounds", () => {
    expect(rules("summary", "Springs retarget.")).toEqual(["too_few_words", "too_few_sentences"]);
  });

  it("allows one why sentence and flags two", () => {
    expect(rules("why", "Copy the pattern for drawers.")).toEqual([]);
    expect(rules("why", "Copy the pattern. Use it for drawers.")).toEqual(["too_many_sentences"]);
  });

  it("flags an empty field", () => {
    expect(rules("summary", "   ")).toEqual(["empty"]);
  });

  it("reports several problems on one field", () => {
    const found = rules("headline", "An incredible game-changing release!");
    expect(found).toEqual(["banned_word", "banned_word", "exclamation"]);
  });
});

describe("the examples in config/voice.md", () => {
  it("passes every strong example in the field it belongs to", () => {
    const [springlet, sonos, measures] = voice.examples;
    expect(rules("headline", springlet?.strong ?? "")).toEqual([]);
    expect(rules("summary", sonos?.strong ?? "")).toEqual([]);
    expect(rules("summary", measures?.strong ?? "")).toEqual([]);
  });

  it("shows the four beats in both strong summaries: four sentences inside the stated range", () => {
    for (const example of voice.examples.slice(1)) {
      expect(countSentences(example.strong)).toBe(4);
      expect(countWords(example.strong)).toBeGreaterThanOrEqual(45);
      expect(countWords(example.strong)).toBeLessThanOrEqual(VOICE_LIMITS.summaryWords);
      expect(longSentences(example.strong, VOICE_LIMITS.sentenceWords)).toEqual([]);
    }
  });

  it("keeps the strong headline inside the headline limit", () => {
    expect(countWords(voice.examples[0]?.strong ?? "")).toBe(11);
  });

  it("trips the linter on the hype example only: the other weak lines fail on vagueness", () => {
    expect(voice.examples.map((example) => rules("headline", example.weak))).toEqual([
      [],
      ["banned_word"],
      [],
    ]);
  });

  it("exposes lint as a plain function over a parsed config", () => {
    expect(lint("headline", "Springs ship!", voice).map((v) => v.rule)).toEqual(["exclamation"]);
  });
});

describe("sentence and word counting", () => {
  it("counts words as tokens with a letter or digit", () => {
    expect(countWords("Springs - and drawers")).toBe(3);
    expect(countWords("mid-flight 2.0")).toBe(2);
  });

  it("splits when the next sentence starts lowercase, so the sentence limits cannot be dodged", () => {
    expect(countSentences("Springs retarget. iPadOS 27 follows. npm packages ship.")).toBe(3);
    expect(
      rules("summary", "A fact. iPadOS adds it. npm ships it. tvOS follows it. watchOS gets it."),
    ).toContain("too_many_sentences");
    expect(rules("summary", "A fact. iPadOS adds it. npm ships it.")).not.toContain(
      "too_many_sentences",
    );
    expect(rules("why", "Copy it. npm has an example.")).toContain("too_many_sentences");
  });

  it("does not split on version numbers, file names or abbreviations", () => {
    expect(countSentences("Springlet 2.0 ships in Next.js, e.g. for drawers.")).toBe(1);
    expect(splitSentences("It ships in the U.S. first. Others follow.")).toHaveLength(2);
  });

  it("splits on end punctuation followed by a capital", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });
});
