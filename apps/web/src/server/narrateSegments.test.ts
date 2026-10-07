import { describe, expect, it } from "vitest";
import type { BlobEntry } from "./blobStore";
import {
  describeSegments,
  digestPrefix,
  parseSegmentEntry,
  SEGMENT_KEY,
  segmentHash,
  segmentPath,
  segmentPrefix,
  slotKey,
} from "./narrateSegments";

const HOST = "https://teststore.public.blob.vercel-storage.com";
const DIGEST = "2026-10-07";
const VOICE = "geffen_32";
const MODEL = "simba-3.2";

const entry = (pathname: string, uploadedAt = 1000, url = `${HOST}/${pathname}`): BlobEntry => ({
  pathname,
  url,
  uploadedAt,
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

describe("segmentPath and parseSegmentEntry", () => {
  it("names a file after its segment, its hash and its duration, under the digest's prefix", () => {
    const hash = segmentHash("Opening.", VOICE, MODEL);
    const path = segmentPath(DIGEST, "intro", hash, 2750.4);
    expect(path).toBe(`audio/2026-10-07/seg/intro.${hash}.2750.mp3`);
    expect(path.startsWith(segmentPrefix(DIGEST))).toBe(true);
    expect(path.startsWith(digestPrefix(DIGEST))).toBe(true);
  });

  it("reads a listed file back into what its name says", () => {
    const hash = segmentHash("A story.", VOICE, MODEL);
    const path = segmentPath(DIGEST, "00000000000a", hash, 41_300);
    expect(parseSegmentEntry(DIGEST, entry(path, 77))).toEqual({
      key: "00000000000a",
      hash,
      durationMs: 41_300,
      url: `${HOST}/${path}`,
      uploadedAt: 77,
    });
  });

  it("is null for anything that is not a segment of this digest", () => {
    const hash = "0123456789ab";
    for (const pathname of [
      `audio/${DIGEST}.mp3`,
      `audio/${DIGEST}-2/seg/intro.${hash}.1000.mp3`,
      `audio/${DIGEST}/seg/intro.mp3`,
      `audio/${DIGEST}/seg/intro.${hash}.mp3`,
      `audio/${DIGEST}/seg/intro.${hash}.0.mp3`,
      `audio/${DIGEST}/seg/intro.${hash}.12x.mp3`,
      `audio/${DIGEST}/seg/intro.${hash.toUpperCase()}.1000.mp3`,
      `audio/${DIGEST}/seg/intro.short.1000.mp3`,
      `audio/${DIGEST}/seg/Intro.${hash}.1000.mp3`,
      `audio/${DIGEST}/seg/deeper/intro.${hash}.1000.mp3`,
      `audio/${DIGEST}/seg/intro.${hash}.1000.wav`,
      `timeline/${DIGEST}.json`,
    ]) {
      expect(parseSegmentEntry(DIGEST, entry(pathname)), pathname).toBeNull();
    }
  });

  it("is null for a file whose URL is not https", () => {
    const path = segmentPath(DIGEST, "intro", "0123456789ab", 1000);
    expect(parseSegmentEntry(DIGEST, entry(path, 1, `http://insecure.example/${path}`))).toBeNull();
    expect(parseSegmentEntry(DIGEST, entry(path, 1, "not a url"))).toBeNull();
  });
});

describe("describeSegments", () => {
  const segments = [
    { key: "intro", itemId: null, text: "Opening." },
    { key: "00000000000a", itemId: "00000000000a", text: "Top stories.\n\nFirst story." },
    { key: "00000000000b", itemId: "00000000000b", text: "Second story." },
  ];
  const fileFor = (index: number, durationMs: number, uploadedAt = 1000) => {
    const segment = segments[index];
    if (!segment) throw new Error("no such segment");
    return entry(
      segmentPath(DIGEST, segment.key, segmentHash(segment.text, VOICE, MODEL), durationMs),
      uploadedAt,
    );
  };

  it("lists every segment in order with its length, narrated or not", () => {
    expect(describeSegments(segments, [], DIGEST, VOICE, MODEL)).toEqual([
      { key: "intro", item_id: null, characters: 8, audio: null },
      { key: "00000000000a", item_id: "00000000000a", characters: 26, audio: null },
      { key: "00000000000b", item_id: "00000000000b", characters: 13, audio: null },
    ]);
  });

  it("gives a segment the file whose name carries its key and its hash", () => {
    const intro = fileFor(0, 2750);
    const second = fileFor(2, 9100);
    const described = describeSegments(segments, [second, intro], DIGEST, VOICE, MODEL);
    expect(described.map((segment) => segment.audio)).toEqual([
      { url: intro.url, duration_ms: 2750 },
      null,
      { url: second.url, duration_ms: 9100 },
    ]);
  });

  it("does not give a segment a file made from other text, another voice or another key", () => {
    const edited = entry(
      segmentPath(DIGEST, "intro", segmentHash("An older opening.", VOICE, MODEL), 2000),
    );
    const otherVoice = entry(
      segmentPath(DIGEST, "intro", segmentHash("Opening.", "henry_7", MODEL), 2000),
    );
    // The intro's own hash under another segment's key.
    const wrongKey = entry(
      segmentPath(DIGEST, "00000000000b", segmentHash("Opening.", VOICE, MODEL), 2000),
    );
    const described = describeSegments(
      segments,
      [edited, otherVoice, wrongKey],
      DIGEST,
      VOICE,
      MODEL,
    );
    expect(described.every((segment) => segment.audio === null)).toBe(true);
  });

  it("names the first upload when the same segment has two files", () => {
    const later = fileFor(0, 2800, 5000);
    const first = fileFor(0, 2750, 1000);
    expect(describeSegments(segments, [later, first], DIGEST, VOICE, MODEL)[0]?.audio).toEqual({
      url: first.url,
      duration_ms: 2750,
    });
  });
});

describe("keys", () => {
  it("accepts the keys segments have and nothing that could leave the segment folder", () => {
    for (const key of ["intro", "outro", "00000000000a"]) expect(SEGMENT_KEY.test(key)).toBe(true);
    for (const key of ["", "../x", "a/b", "a.b", "Intro", "x".repeat(33)]) {
      expect(SEGMENT_KEY.test(key), key).toBe(false);
    }
  });

  it("keeps one slot per digest", () => {
    expect(slotKey(DIGEST)).toBe("state/slots/2026-10-07.json");
  });
});
