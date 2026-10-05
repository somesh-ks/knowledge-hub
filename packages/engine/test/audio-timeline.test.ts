import { AudioTimeline } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import type { SpeechMark } from "../src/audio/speechify.js";
import { buildSpokenText } from "../src/audio/spokenText.js";
import {
  alignMarks,
  buildTimeline,
  estimateTimeline,
  resolveTimeline,
  TimelineError,
} from "../src/audio/timeline.js";
import { makeDigest, must, wordCount, wordIndexAt, wordMarks } from "./audio-fixtures.js";

const digest = makeDigest({}, 6);
const spoken = buildSpokenText(digest);
const LEAD = 125;
const WORD = 300;
const DURATION = (wordCount(spoken.text) + 4) * WORD;
const base = { digest, spoken, durationMs: DURATION, voice: "geffen_32", model: "simba-3.2" };

/** Time of the first word at or after `offset` under the default wordMarks spacing. */
const timeAt = (offset: number): number => LEAD + wordIndexAt(spoken.text, offset) * WORD;

describe("buildTimeline", () => {
  const timeline = buildTimeline({ ...base, marks: wordMarks(spoken.text) });

  it("starts each item at the first mark at or after its range start", () => {
    expect(timeline.items.map((item) => item.start_ms)).toEqual(
      spoken.ranges.map((range) => timeAt(range.start)),
    );
  });

  it("ends each item where the next one starts and the last at the duration", () => {
    timeline.items.forEach((item, index) => {
      const next = timeline.items[index + 1];
      expect(item.end_ms).toBe(next ? next.start_ms : DURATION);
    });
  });

  it("starts each section at its title's first word", () => {
    expect(timeline.sections).toEqual(
      spoken.sectionStarts.map((section) => ({
        slug: section.slug,
        start_ms: timeAt(section.start),
      })),
    );
  });

  it("places a section start at or before its first item", () => {
    for (const section of timeline.sections) {
      const first = must(timeline.items.find((item) => item.section === section.slug));
      expect(section.start_ms).toBeLessThanOrEqual(first.start_ms);
    }
  });

  it("carries the identifying fields and flags the marks source", () => {
    expect(timeline).toMatchObject({
      digest: "2026-10-07",
      voice: "geffen_32",
      model: "simba-3.2",
      timeline: "marks",
      duration_ms: DURATION,
      text_chars: spoken.text.length,
    });
  });

  it("emits item ids and sections in narration order", () => {
    expect(timeline.items.map((item) => [item.id, item.section])).toEqual(
      spoken.ranges.map((range) => [range.id, range.section]),
    );
  });

  it("produces a document that satisfies the core schema", () => {
    expect(() => AudioTimeline.parse(timeline)).not.toThrow();
  });

  it("keeps start times strictly increasing for evenly spaced marks", () => {
    for (let index = 1; index < timeline.items.length; index++) {
      expect(must(timeline.items[index]).start_ms).toBeGreaterThan(
        must(timeline.items[index - 1]).start_ms,
      );
    }
  });

  it("handles marks that begin after leading silence", () => {
    const quiet = buildTimeline({ ...base, marks: wordMarks(spoken.text, { leadingMs: 900 }) });
    expect(quiet.items.map((item) => item.start_ms)).toEqual(
      spoken.ranges.map((range) => 900 + wordIndexAt(spoken.text, range.start) * WORD),
    );
    expect(must(quiet.items[0]).start_ms).toBeGreaterThan(900);
  });

  it("takes the next mark when an item's first word has no mark", () => {
    const first = must(spoken.ranges[1]);
    const marks = wordMarks(spoken.text, { skip: (_word, _index, start) => start === first.start });
    const result = buildTimeline({ ...base, marks });
    expect(must(result.items[1]).start_ms).toBe(timeAt(first.start) + WORD);
  });

  it("tolerates gaps in the mark offsets", () => {
    const marks = wordMarks(spoken.text, { skip: (_word, index) => index % 5 === 3 });
    const result = buildTimeline({ ...base, marks });
    expect(result.items).toHaveLength(spoken.ranges.length);
    for (const item of result.items) expect(item.end_ms).toBeGreaterThan(item.start_ms);
  });

  it("rejects when every word of an item is missing", () => {
    const victim = must(spoken.ranges[2]);
    const marks = wordMarks(spoken.text, {
      skip: (_word, _index, start) => start >= victim.start && start < victim.end,
    });
    expect(() => buildTimeline({ ...base, marks })).toThrow(TimelineError);
    expect(() => buildTimeline({ ...base, marks })).toThrow(new RegExp(victim.id));
  });

  it("rejects an item whose marks were dropped at the end of the text", () => {
    const last = must(spoken.ranges.at(-1));
    const marks = wordMarks(spoken.text, { skip: (_word, _index, start) => start >= last.start });
    expect(() => buildTimeline({ ...base, marks })).toThrow(TimelineError);
  });

  it("rejects an empty mark list", () => {
    expect(() => buildTimeline({ ...base, marks: [] })).toThrow(/No usable word marks/);
  });

  it("forces non-decreasing start times even if the marks run backwards", () => {
    const marks = wordMarks(spoken.text).map((mark, index, all) => ({
      ...mark,
      start_time: (all.length - index) * WORD,
    }));
    const result = buildTimeline({
      ...base,
      marks,
      durationMs: (wordCount(spoken.text) + 4) * WORD,
    });
    const starts = result.items.map((item) => item.start_ms);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("rounds fractional mark times to whole milliseconds", () => {
    const marks = wordMarks(spoken.text).map((mark) => ({
      ...mark,
      start_time: mark.start_time + 0.4,
    }));
    const result = buildTimeline({ ...base, marks });
    for (const item of result.items) {
      expect(Number.isInteger(item.start_ms)).toBe(true);
      expect(Number.isInteger(item.end_ms)).toBe(true);
    }
  });

  it("ignores marks that are not words", () => {
    const sentence: SpeechMark = {
      type: "sentence",
      start: 0,
      end: 5,
      start_time: 1,
      end_time: 9000,
      value: "Dispa",
    };
    const withNoise = buildTimeline({ ...base, marks: [sentence, ...wordMarks(spoken.text)] });
    expect(withNoise).toEqual(timeline);
  });

  it("accepts marks that arrive out of order", () => {
    const shuffled = wordMarks(spoken.text).reverse();
    expect(buildTimeline({ ...base, marks: shuffled }).items.map((item) => item.start_ms)).toEqual(
      timeline.items.map((item) => item.start_ms),
    );
  });

  it("rejects marks that run past the audio duration", () => {
    expect(() =>
      buildTimeline({ ...base, marks: wordMarks(spoken.text), durationMs: 5000 }),
    ).toThrow(/past the audio duration/);
  });

  it.each([0, -5, Number.NaN])("rejects a duration of %s", (durationMs) => {
    expect(() => buildTimeline({ ...base, marks: wordMarks(spoken.text), durationMs })).toThrow(
      TimelineError,
    );
  });

  it("matches a brute-force scan for every item boundary", () => {
    const marks = wordMarks(spoken.text, { skip: (_word, index) => index % 7 === 0 });
    const aligned = alignMarks(spoken.text, marks);
    const result = buildTimeline({ ...base, marks });
    spoken.ranges.forEach((range, index) => {
      const expected = must(aligned.find((mark) => mark.start >= range.start));
      expect(must(result.items[index]).start_ms).toBe(expected.startMs);
    });
  });
});

describe("alignMarks", () => {
  it("keeps marks whose offsets match their text", () => {
    const aligned = alignMarks(spoken.text, wordMarks(spoken.text));
    expect(aligned).toHaveLength(wordCount(spoken.text));
    expect(must(aligned[0])).toEqual({ start: 0, startMs: LEAD });
  });

  it("re-anchors marks whose offsets drifted, using the word text", () => {
    const drifted = wordMarks(spoken.text).map((mark) => ({
      ...mark,
      start: mark.start + 3,
      end: mark.end + 3,
    }));
    const result = buildTimeline({ ...base, marks: drifted });
    expect(result.items.map((item) => item.start_ms)).toEqual(
      spoken.ranges.map((range) => timeAt(range.start)),
    );
  });

  it("drops a mark whose text is nowhere to be found", () => {
    const bogus: SpeechMark = {
      type: "word",
      start: 0,
      end: 5,
      start_time: 0,
      end_time: 10,
      value: "zzzzzz",
    };
    expect(alignMarks("Hello world.", [bogus])).toEqual([]);
  });

  it("drops marks with empty text", () => {
    const empty: SpeechMark = {
      type: "word",
      start: 99,
      end: 99,
      start_time: 0,
      end_time: 10,
      value: "",
    };
    expect(alignMarks("Hello world.", [empty])).toEqual([]);
  });

  it("sorts by position", () => {
    const marks = wordMarks("alpha beta gamma").reverse();
    expect(alignMarks("alpha beta gamma", marks).map((mark) => mark.start)).toEqual([0, 6, 11]);
  });

  it("treats a mark with no type as a word", () => {
    const { type: _type, ...untyped } = must(wordMarks("alpha beta")[0]);
    expect(alignMarks("alpha beta", [untyped])).toHaveLength(1);
  });
});

describe("estimateTimeline", () => {
  const estimated = estimateTimeline(base);

  it("flags the timeline as estimated", () => {
    expect(estimated.timeline).toBe("estimated");
    expect(() => AudioTimeline.parse(estimated)).not.toThrow();
  });

  it("places starts by character share of the duration", () => {
    spoken.ranges.forEach((range, index) => {
      expect(must(estimated.items[index]).start_ms).toBe(
        Math.round((range.start / spoken.text.length) * DURATION),
      );
    });
  });

  it("chains each end to the next start and ends the last at the duration", () => {
    estimated.items.forEach((item, index) => {
      const next = estimated.items[index + 1];
      expect(item.end_ms).toBe(next ? next.start_ms : DURATION);
    });
  });

  it("estimates section starts from the title offset", () => {
    expect(estimated.sections).toEqual(
      spoken.sectionStarts.map((section) => ({
        slug: section.slug,
        start_ms: Math.round((section.start / spoken.text.length) * DURATION),
      })),
    );
  });

  it("keeps starts non-decreasing and inside the audio", () => {
    const starts = estimated.items.map((item) => item.start_ms);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(Math.max(...starts)).toBeLessThan(DURATION);
  });

  it("rejects a non-positive duration", () => {
    expect(() => estimateTimeline({ ...base, durationMs: 0 })).toThrow(TimelineError);
  });
});

describe("resolveTimeline", () => {
  it("uses marks when they place every item", () => {
    const resolved = resolveTimeline({ ...base, marks: wordMarks(spoken.text) });
    expect(resolved.timeline.timeline).toBe("marks");
    expect(resolved.degradedReason).toBeUndefined();
  });

  it("estimates, with a reason, when there are no marks", () => {
    const resolved = resolveTimeline({ ...base, marks: [] });
    expect(resolved.timeline.timeline).toBe("estimated");
    expect(resolved.degradedReason).toMatch(/no word marks/i);
  });

  it("estimates, with a reason, when marks miss an item", () => {
    const victim = must(spoken.ranges[0]);
    const marks = wordMarks(spoken.text, {
      skip: (_word, _index, start) => start >= victim.start && start < victim.end,
    });
    const resolved = resolveTimeline({ ...base, marks });
    expect(resolved.timeline.timeline).toBe("estimated");
    expect(resolved.degradedReason).toContain(victim.id);
  });

  it("lets a duration error through when even the estimate is impossible", () => {
    expect(() => resolveTimeline({ ...base, marks: [], durationMs: 0 })).toThrow(TimelineError);
  });
});
