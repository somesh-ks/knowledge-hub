import { describe, expect, it } from "vitest";
import type { BlobEntry } from "./blobStore";
import { MS_PER_CHARACTER } from "./config";
import {
  deriveSegmentMarks,
  describeSegments,
  estimateDurationMs,
  estimateFromText,
  SEGMENT_KEY,
  segmentAudio,
  segmentHash,
  segmentMarksPath,
  segmentPath,
  segmentPrefix,
} from "./narrateSegments";

const HOST = "https://teststore.public.blob.vercel-storage.com";
const DIGEST = "2026-10-07";
const VOICE = "geffen_32";
const MODEL = "simba-3.2";

const entry = (pathname: string, size = 16_000, url = `${HOST}/${pathname}`): BlobEntry => ({
  pathname,
  url,
  uploadedAt: 1000,
  size,
  version: "v1",
  etag: '"v1"',
});

describe("segmentHash", () => {
  it("is the same for the same text, voice and model", () => {
    expect(segmentHash("A story.", VOICE, MODEL)).toBe(segmentHash("A story.", VOICE, MODEL));
    expect(segmentHash("A story.", VOICE, MODEL)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes when the text, the voice or the model changes", () => {
    const base = segmentHash("A story.", VOICE, MODEL);
    expect(segmentHash("A story!", VOICE, MODEL)).not.toBe(base);
    expect(segmentHash("A story.", "henry_7", MODEL)).not.toBe(base);
    expect(segmentHash("A story.", VOICE, "simba-4")).not.toBe(base);
  });

  it("does not confuse where the voice ends and the text begins", () => {
    expect(segmentHash("b\nc", "a", MODEL)).not.toBe(segmentHash("c", "a\nb", MODEL));
  });
});

describe("segmentPath", () => {
  it("can be worked out from the digest alone, so finding a segment needs no listing", () => {
    const hash = segmentHash("Opening.", VOICE, MODEL);
    const path = segmentPath(DIGEST, "intro", hash);
    expect(path).toBe(`audio/2026-10-07/seg/intro.${hash}.mp3`);
    expect(path.startsWith(segmentPrefix(DIGEST))).toBe(true);
  });
});

describe("durations", () => {
  it("works a duration out from the size: 128 kbps is 16,000 bytes a second", () => {
    expect(estimateDurationMs(16_000, 50)).toBe(1000);
    expect(estimateDurationMs(44_000, 50)).toBe(2750);
    expect(estimateDurationMs(1, 50)).toBe(1);
  });

  it("guesses from the length of the text when there is no size to go by", () => {
    expect(estimateFromText(100)).toBe(100 * MS_PER_CHARACTER);
    expect(estimateFromText(0)).toBe(1);
    expect(estimateDurationMs(0, 100)).toBe(100 * MS_PER_CHARACTER);
  });
});

describe("segmentAudio", () => {
  it("is a file the store has confirmed, or null when there is none or it is not https", () => {
    const path = segmentPath(DIGEST, "intro", "0123456789ab");
    expect(segmentAudio(entry(path, 32_000), 40)).toEqual({
      url: `${HOST}/${path}`,
      duration_ms: 2000,
      confirmed: true,
    });
    expect(segmentAudio(null, 40)).toBeNull();
    expect(segmentAudio(undefined, 40)).toBeNull();
    expect(segmentAudio(entry(path, 32_000, `http://insecure.example/${path}`), 40)).toBeNull();
    expect(segmentAudio(entry(path, 32_000, "not a url"), 40)).toBeNull();
  });
});

describe("describeSegments", () => {
  const segments = [
    { key: "intro", itemId: null, text: "Opening." },
    { key: "00000000000a", itemId: "00000000000a", text: "Top stories.\n\nFirst story." },
    { key: "00000000000b", itemId: "00000000000b", text: "Second story." },
  ];
  const urlOf = (index: number, voice = VOICE) => {
    const segment = segments[index];
    if (!segment) throw new Error("no such segment");
    return `${HOST}/${segmentPath(DIGEST, segment.key, segmentHash(segment.text, voice, MODEL))}`;
  };

  it("gives every segment the address its file would have, unconfirmed, with a guessed duration", () => {
    expect(describeSegments(segments, HOST, DIGEST, VOICE, MODEL)).toEqual([
      {
        key: "intro",
        item_id: null,
        characters: 8,
        audio: { url: urlOf(0), duration_ms: 8 * MS_PER_CHARACTER, confirmed: false },
      },
      {
        key: "00000000000a",
        item_id: "00000000000a",
        characters: 26,
        audio: { url: urlOf(1), duration_ms: 26 * MS_PER_CHARACTER, confirmed: false },
      },
      {
        key: "00000000000b",
        item_id: "00000000000b",
        characters: 13,
        audio: { url: urlOf(2), duration_ms: 13 * MS_PER_CHARACTER, confirmed: false },
      },
    ]);
  });

  it("gives another address for another voice, text or digest", () => {
    const base = describeSegments(segments, HOST, DIGEST, VOICE, MODEL)[0]?.audio?.url;
    expect(describeSegments(segments, HOST, DIGEST, "henry_7", MODEL)[0]?.audio?.url).toBe(
      urlOf(0, "henry_7"),
    );
    expect(urlOf(0, "henry_7")).not.toBe(base);
    const edited = [{ key: "intro", itemId: null, text: "Another opening." }];
    expect(describeSegments(edited, HOST, DIGEST, VOICE, MODEL)[0]?.audio?.url).not.toBe(base);
    expect(describeSegments(segments, HOST, "2026-10-07-2", VOICE, MODEL)[0]?.audio?.url).not.toBe(
      base,
    );
  });

  it("gives no address at all when the store's public address is not known", () => {
    expect(describeSegments(segments, null, DIGEST, VOICE, MODEL)).toEqual([
      { key: "intro", item_id: null, characters: 8, audio: null },
      { key: "00000000000a", item_id: "00000000000a", characters: 26, audio: null },
      { key: "00000000000b", item_id: "00000000000b", characters: 13, audio: null },
    ]);
  });
});

describe("segment keys", () => {
  it("accepts the keys segments have and nothing that could leave the segment folder", () => {
    for (const key of ["intro", "outro", "00000000000a"]) expect(SEGMENT_KEY.test(key)).toBe(true);
    for (const key of ["", "../x", "a/b", "a.b", "Intro", "x".repeat(33)]) {
      expect(SEGMENT_KEY.test(key), key).toBe(false);
    }
  });
});

describe("segment word marks", () => {
  const mark = (start: number, value: string, startTime: number, endTime = startTime + 200) => ({
    type: "word",
    start,
    end: start + value.length,
    start_time: startTime,
    end_time: endTime,
    value,
  });

  it("live beside the audio, under the same hash", () => {
    const path = segmentPath(DIGEST, "t3", "0123456789ab");
    expect(segmentMarksPath(path)).toBe("audio/2026-10-07/seg/t3.0123456789ab.marks.json");
  });

  it("number the words as the text split on white space, with times from the segment's start", () => {
    const text = "  Hello,\n there  world ";
    const marks = [mark(2, "Hello,", 0.4), mark(10, "there", 300.6), mark(17, "world", 610)];
    expect(deriveSegmentMarks(text, marks)).toEqual([
      { word: 0, start_ms: 0, end_ms: 200 },
      { word: 1, start_ms: 301, end_ms: 501 },
      { word: 2, start_ms: 610, end_ms: 810 },
    ]);
  });

  it("re-anchor a mark whose offsets are off, and drop one whose text is not there", () => {
    const text = "One two three";
    const marks = [
      mark(0, "One", 0),
      mark(9, "two", 250),
      mark(20, "four", 400),
      mark(1, "three", 600),
    ];
    expect(deriveSegmentMarks(text, marks).map((word) => word.word)).toEqual([0, 1, 2]);
  });

  it("give a word with several marks the first start and the last end", () => {
    const text = "e-mail me";
    const marks = [mark(0, "e", 0, 100), mark(2, "mail", 120, 300), mark(7, "me", 320)];
    expect(deriveSegmentMarks(text, marks)).toEqual([
      { word: 0, start_ms: 0, end_ms: 300 },
      { word: 1, start_ms: 320, end_ms: 520 },
    ]);
  });

  it("skip marks that are not words, and never let a start run backwards", () => {
    const text = "a b";
    const marks = [{ ...mark(0, "a", 0), type: "sentence" }, mark(0, "a", 500), mark(2, "b", 400)];
    expect(deriveSegmentMarks(text, marks)).toEqual([
      { word: 0, start_ms: 500, end_ms: 700 },
      { word: 1, start_ms: 500, end_ms: 600 },
    ]);
  });

  it("are empty without marks or words", () => {
    expect(deriveSegmentMarks("a b", [])).toEqual([]);
    expect(deriveSegmentMarks("   ", [mark(0, " ", 0)])).toEqual([]);
  });
});
