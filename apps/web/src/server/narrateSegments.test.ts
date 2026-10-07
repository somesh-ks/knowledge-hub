import { describe, expect, it } from "vitest";
import type { BlobEntry } from "./blobStore";
import { MS_PER_CHARACTER } from "./config";
import {
  describeSegments,
  digestPrefix,
  estimateDurationMs,
  SEGMENT_KEY,
  segmentAudio,
  segmentHash,
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
    // And one listing of the digest's prefix finds it together with the whole-digest MP3.
    expect(path.startsWith(digestPrefix(DIGEST))).toBe(true);
    expect(`audio/${DIGEST}.mp3`.startsWith(digestPrefix(DIGEST))).toBe(true);
  });
});

describe("estimateDurationMs and segmentAudio", () => {
  it("works a duration out from the size: 128 kbps is 16,000 bytes a second", () => {
    expect(estimateDurationMs(16_000, 50)).toBe(1000);
    expect(estimateDurationMs(44_000, 50)).toBe(2750);
    expect(estimateDurationMs(1, 50)).toBe(1);
  });

  it("falls back to the length of the text when the store reports no size", () => {
    expect(estimateDurationMs(0, 100)).toBe(100 * MS_PER_CHARACTER);
    expect(estimateDurationMs(0, 0)).toBe(1);
  });

  it("is the stored file as audio, or null when there is none or it is not https", () => {
    const path = segmentPath(DIGEST, "intro", "0123456789ab");
    expect(segmentAudio(entry(path, 32_000), 40)).toEqual({
      url: `${HOST}/${path}`,
      duration_ms: 2000,
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
  const fileFor = (index: number, size: number) => {
    const segment = segments[index];
    if (!segment) throw new Error("no such segment");
    return entry(segmentPath(DIGEST, segment.key, segmentHash(segment.text, VOICE, MODEL)), size);
  };

  it("lists every segment in order with its length, narrated or not", () => {
    expect(describeSegments(segments, [], DIGEST, VOICE, MODEL)).toEqual([
      { key: "intro", item_id: null, characters: 8, audio: null },
      { key: "00000000000a", item_id: "00000000000a", characters: 26, audio: null },
      { key: "00000000000b", item_id: "00000000000b", characters: 13, audio: null },
    ]);
  });

  it("gives a segment the file at the path its text and voice work out to", () => {
    const intro = fileFor(0, 44_000);
    const second = fileFor(2, 145_600);
    const described = describeSegments(segments, [second, intro], DIGEST, VOICE, MODEL);
    expect(described.map((segment) => segment.audio)).toEqual([
      { url: intro.url, duration_ms: 2750 },
      null,
      { url: second.url, duration_ms: 9100 },
    ]);
  });

  it("does not give a segment a file made from other text, another voice or another key", () => {
    const edited = entry(
      segmentPath(DIGEST, "intro", segmentHash("An older opening.", VOICE, MODEL)),
    );
    const otherVoice = entry(
      segmentPath(DIGEST, "intro", segmentHash("Opening.", "henry_7", MODEL)),
    );
    // The intro's own hash under another segment's key, and in another digest's folder.
    const hash = segmentHash("Opening.", VOICE, MODEL);
    const wrongKey = entry(segmentPath(DIGEST, "00000000000b", hash));
    const otherDigest = entry(segmentPath("2026-10-07-2", "intro", hash));
    const described = describeSegments(
      segments,
      [edited, otherVoice, wrongKey, otherDigest],
      DIGEST,
      VOICE,
      MODEL,
    );
    expect(described.every((segment) => segment.audio === null)).toBe(true);
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
