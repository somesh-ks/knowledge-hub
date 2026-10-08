import { describe, expect, it } from "vitest";
import type { BlobEntry } from "./blobStore";
import { MS_PER_CHARACTER } from "./config";
import {
  describeSegments,
  estimateDurationMs,
  estimateFromText,
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
