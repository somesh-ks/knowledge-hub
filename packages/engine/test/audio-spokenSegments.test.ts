import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Digest, parseDigestFile } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { bridgeCandidates } from "../src/audio/hostFrame.js";
import {
  INTRO_KEY,
  leadInWords,
  OUTRO_KEY,
  type SpokenSegment,
  segmentSpokenText,
  spokenSegments,
} from "../src/audio/spokenSegments.js";
import { buildSpokenText, itemBlock, type SpokenText } from "../src/audio/spokenText.js";
import { makeDigest, makeItem, must } from "./audio-fixtures.js";

const DIGESTS = join(import.meta.dirname, "..", "..", "..", "Digests");

/** Every digest committed under Digests/, so the proof runs on real narration, not only on fixtures. */
function committedDigests(): Digest[] {
  if (!existsSync(DIGESTS)) return [];
  return readdirSync(DIGESTS, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => parseDigestFile(readFileSync(join(DIGESTS, name), "utf8")));
}

/**
 * The proof that segments and spoken text cannot disagree: walking the full text, each segment is
 * found exactly where the previous one stopped, with nothing between them but the same separator
 * every time, and nothing left over. So the segments joined with that separator are the full text.
 * The separator is read from the text itself, so this holds whatever spokenText uses.
 */
function expectSegmentsToRebuild(text: string, segments: SpokenSegment[]): void {
  const gaps: string[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const at = text.indexOf(segment.text, cursor);
    expect(at, `segment ${segment.key} is not in the text after offset ${cursor}`).toBeGreaterThan(
      -1,
    );
    gaps.push(text.slice(cursor, at));
    cursor = at + segment.text.length;
  }
  expect(text.slice(cursor), "text is left over after the last segment").toBe("");
  expect(gaps[0], "text before the first segment").toBe("");
  const separator = gaps[1] ?? "";
  expect(separator, "the separator is white space only").toMatch(/^\s*$/);
  expect(gaps.slice(1).every((gap) => gap === separator)).toBe(true);
  expect(segments.map((segment) => segment.text).join(separator)).toBe(text);
}

describe("spokenSegments", () => {
  it("rebuilds the full spoken text of every committed digest", () => {
    const digests = committedDigests();
    expect(digests.length).toBeGreaterThanOrEqual(2);
    for (const digest of digests) {
      expectSegmentsToRebuild(buildSpokenText(digest).text, spokenSegments(digest));
    }
  });

  it("rebuilds the full spoken text of a fixture, whatever its sections and sizes", () => {
    for (const itemCount of [3, 5, 12, 18]) {
      const digest = makeDigest({}, itemCount);
      expectSegmentsToRebuild(buildSpokenText(digest).text, spokenSegments(digest));
    }
    const weekly = makeDigest({ id: "2026-10-11-weekly", date: "2026-10-11", kind: "weekly" }, 9);
    expectSegmentsToRebuild(buildSpokenText(weekly).text, spokenSegments(weekly));
  });

  it("counts the host's words before each story's own block, so a page can skip them", () => {
    const digest = makeDigest({}, 12);
    const lead = leadInWords(digest);
    for (const segment of spokenSegments(digest)) {
      if (segment.itemId === null) continue;
      const item = must(digest.items.find((candidate) => candidate.id === segment.itemId));
      const words = segment.text.match(/\S+/g) ?? [];
      const story = itemBlock(item).match(/\S+/g) ?? [];
      expect(words.slice(words.length - story.length).join(" ")).toBe(story.join(" "));
      expect(lead.get(item.id) ?? 0).toBe(words.length - story.length);
    }
    // At least the first story of a later section opens with a bridge.
    expect([...lead.values()].some((count) => count > 0)).toBe(true);
  });

  it("is the intro, then one segment per story in spoken order", () => {
    const digest = makeDigest({}, 6);
    const spoken = buildSpokenText(digest);
    const segments = spokenSegments(digest);

    expect(segments.map((segment) => segment.key)).toEqual([
      INTRO_KEY,
      ...spoken.ranges.map((range) => range.id),
      OUTRO_KEY,
    ]);
    expect(segments[0]).toEqual({
      key: INTRO_KEY,
      itemId: null,
      text: spoken.text.slice(0, must(spoken.sectionStarts[0]).start).trim(),
    });
    for (const segment of segments.slice(1, -1)) expect(segment.itemId).toBe(segment.key);
    // The sign-off is a segment of its own, with no story behind it.
    expect(segments.at(-1)).toEqual({
      key: OUTRO_KEY,
      itemId: null,
      text: "That's the briefing. More in two days.",
    });
  });

  it("keeps a bridge with the story it introduces, never with the one before it", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, { section: "top" }),
        makeItem(1, { section: "ai" }),
        makeItem(2, { section: "ai" }),
      ],
    });
    const spoken = buildSpokenText(digest);
    const segments = spokenSegments(digest);
    const bridge = must(spoken.sectionStarts.find((section) => section.slug === "ai"));
    const bridgeText = spoken.text.slice(bridge.start).split("\n")[0] ?? "";
    expect(bridgeText.length).toBeGreaterThan(0);
    const ai = must(segments.find((segment) => segment.key === must(digest.items[1]).id));
    const top = must(segments.find((segment) => segment.key === must(digest.items[0]).id));
    expect(ai.text.startsWith(bridgeText)).toBe(true);
    expect(top.text).not.toContain(bridgeText);
  });

  it("gives a section's bridge to the first story of that section, and to no other", () => {
    const digest = makeDigest({
      items: [
        makeItem(0, { section: "top" }),
        makeItem(1, { section: "top" }),
        makeItem(2, { section: "ai" }),
        makeItem(3, { section: "ai" }),
      ],
    });
    const [, first, second, third, fourth] = spokenSegments(digest);
    const bridges = bridgeCandidates("ai", 2);
    const bridgeOf = (text: string): string | undefined =>
      bridges.find((candidate) => text.startsWith(candidate));

    // The opening already said the briefing starts with the top picks, so no bridge before them.
    expect(must(first).text.startsWith("Headline number 1")).toBe(true);
    expect(bridgeOf(must(second).text)).toBeUndefined();
    expect(must(second).text).toContain("Headline number 2");
    expect(bridgeOf(must(third).text)).toBeDefined();
    expect(must(third).text).toContain("Headline number 3");
    expect(bridgeOf(must(fourth).text)).toBeUndefined();
  });

  it("holds exactly the item's own text plus the lead-in, so the item ranges still fit", () => {
    const digest = makeDigest({}, 5);
    const spoken = buildSpokenText(digest);
    const segments = spokenSegments(digest);
    for (const range of spoken.ranges) {
      const segment = must(segments.find((candidate) => candidate.key === range.id));
      expect(segment.text.endsWith(spoken.text.slice(range.start, range.end))).toBe(true);
    }
  });
});

describe("segmentSpokenText", () => {
  /** Spoken text built by hand, to show what a change in spokenText would do to the segments. */
  function spokenOf(
    parts: Array<{ text: string; item?: string; section?: string }>,
    separator: string,
  ) {
    const spoken: SpokenText = { text: "", ranges: [], sectionStarts: [] };
    parts.forEach((part, index) => {
      if (index > 0) spoken.text += separator;
      const start = spoken.text.length;
      spoken.text += part.text;
      if (part.item) {
        spoken.ranges.push({ id: part.item, section: "top", start, end: spoken.text.length });
      } else if (part.section) {
        spoken.sectionStarts.push({ slug: "top", start });
      }
    });
    return spoken;
  }

  it("makes a closing line the outro", () => {
    const spoken = spokenOf(
      [
        { text: "Dispatch, Wednesday 7 October." },
        { text: "Top stories.", section: "top" },
        { text: "First story.", item: "aaaaaaaaaaaa" },
        { text: "Second story.", item: "bbbbbbbbbbbb" },
        { text: "That is all for today." },
      ],
      "\n\n",
    );
    const segments = segmentSpokenText(spoken);
    expect(segments).toEqual([
      { key: INTRO_KEY, itemId: null, text: "Dispatch, Wednesday 7 October." },
      { key: "aaaaaaaaaaaa", itemId: "aaaaaaaaaaaa", text: "Top stories.\n\nFirst story." },
      { key: "bbbbbbbbbbbb", itemId: "bbbbbbbbbbbb", text: "Second story." },
      { key: OUTRO_KEY, itemId: null, text: "That is all for today." },
    ]);
    expectSegmentsToRebuild(spoken.text, segments);
  });

  it("follows another separator without being told", () => {
    const spoken = spokenOf(
      [
        { text: "Opening." },
        { text: "First story.", item: "aaaaaaaaaaaa" },
        { text: "Second story.", item: "bbbbbbbbbbbb" },
      ],
      " \n",
    );
    expectSegmentsToRebuild(spoken.text, segmentSpokenText(spoken));
  });

  it("never drops text that no range claims: it stays with the story it follows", () => {
    const spoken = spokenOf(
      [
        { text: "Opening." },
        { text: "First story.", item: "aaaaaaaaaaaa" },
        { text: "A word from nobody." },
        { text: "Second story.", item: "bbbbbbbbbbbb" },
      ],
      "\n\n",
    );
    const segments = segmentSpokenText(spoken);
    expect(segments.map((segment) => segment.key)).toEqual([
      INTRO_KEY,
      "aaaaaaaaaaaa",
      "bbbbbbbbbbbb",
    ]);
    expect(must(segments[1]).text).toBe("First story.\n\nA word from nobody.");
    expectSegmentsToRebuild(spoken.text, segments);
  });

  it("has no intro when the text opens with a story, and is one intro when there are no stories", () => {
    const direct = spokenOf([{ text: "Only story.", item: "aaaaaaaaaaaa" }], "\n\n");
    expect(segmentSpokenText(direct).map((segment) => segment.key)).toEqual(["aaaaaaaaaaaa"]);
    const empty = spokenOf([{ text: "Dispatch. Zero items." }], "\n\n");
    expect(segmentSpokenText(empty)).toEqual([
      { key: INTRO_KEY, itemId: null, text: "Dispatch. Zero items." },
    ]);
  });
});
