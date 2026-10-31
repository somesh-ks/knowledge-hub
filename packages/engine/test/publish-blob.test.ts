import { describe, expect, it } from "vitest";
import {
  AUDIO_PREFIX,
  audioKey,
  audioVersion,
  DEFAULT_CACHE_MAX_AGE_SECONDS,
  isPruneDay,
  pruneAudio,
  uploadAudio,
} from "../src/publish/blob.js";
import { makeFakeBlob, must } from "./audio-fixtures.js";

const NOW = new Date("2026-10-07T06:00:00Z");
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

describe("audioKey", () => {
  it("is audio/<digest id>.<version>.mp3, and the old audio/<digest id>.mp3 without a version", () => {
    expect(audioKey("2026-10-07", "abc123")).toBe("audio/2026-10-07.abc123.mp3");
    expect(audioKey("2026-10-11-weekly")).toBe("audio/2026-10-11-weekly.mp3");
    expect(audioKey("2026-10-07-2")).toBe("audio/2026-10-07-2.mp3");
  });

  it.each(["../secrets", "2026-10-07/../x", "x", "2026-10-07.mp3", ""])(
    "rejects the id %j",
    (id) => {
      expect(() => audioKey(id)).toThrow();
    },
  );
});

// A regenerated narration was rewritten at the same URL, so a browser, the CDN or the service worker
// could play the old MP3 (plan section 20, criterion 6).
describe("uploadAudio", () => {
  const audio = new Uint8Array([1, 2, 3, 4]);

  it("uploads to a hashed key as audio/mpeg with the year-long cache and returns the public URL", async () => {
    const blob = makeFakeBlob();
    const url = await uploadAudio(blob, { digestId: "2026-10-07", audio });
    const key = `audio/2026-10-07.${audioVersion(audio)}.mp3`;
    expect(url).toBe(`https://store.public.blob.vercel-storage.com/${key}`);
    expect(blob.puts).toEqual([key]);
    const stored = must(blob.store.get(key));
    expect(stored.body).toEqual(audio);
    expect(stored.options).toEqual({
      contentType: "audio/mpeg",
      cacheControlMaxAge: DEFAULT_CACHE_MAX_AGE_SECONDS,
    });
    expect(DEFAULT_CACHE_MAX_AGE_SECONDS).toBe(31_536_000);
  });

  it("passes a custom cache lifetime through", async () => {
    const blob = makeFakeBlob();
    await uploadAudio(blob, { digestId: "2026-10-07", audio, cacheControlMaxAge: 3600 });
    const [key] = blob.puts;
    expect(must(blob.store.get(must(key))).options.cacheControlMaxAge).toBe(3600);
  });

  it("gives regenerated audio a new URL and the same bytes the same URL", async () => {
    const blob = makeFakeBlob();
    const first = await uploadAudio(blob, { digestId: "2026-10-07", audio });
    const again = await uploadAudio(blob, { digestId: "2026-10-07", audio });
    const second = await uploadAudio(blob, { digestId: "2026-10-07", audio: new Uint8Array([9]) });
    expect(again).toBe(first);
    expect(second).not.toBe(first);
    expect(blob.store.size).toBe(2);
  });

  it("refuses empty audio before any request", async () => {
    const blob = makeFakeBlob();
    await expect(
      uploadAudio(blob, { digestId: "2026-10-07", audio: new Uint8Array() }),
    ).rejects.toThrow(/empty audio/);
    expect(blob.puts).toEqual([]);
  });

  it("refuses an invalid digest id before any request", async () => {
    const blob = makeFakeBlob();
    await expect(uploadAudio(blob, { digestId: "../x", audio })).rejects.toThrow();
    expect(blob.puts).toEqual([]);
  });

  it("rejects a returned URL that is not https", async () => {
    const blob = makeFakeBlob();
    blob.put = async (pathname) => ({ url: `http://store.example/${pathname}`, pathname });
    await expect(uploadAudio(blob, { digestId: "2026-10-07", audio })).rejects.toThrow(/not https/);
  });

  it("rejects a returned URL that does not parse", async () => {
    const blob = makeFakeBlob();
    blob.put = async (pathname) => ({ url: "not a url", pathname });
    await expect(uploadAudio(blob, { digestId: "2026-10-07", audio })).rejects.toThrow(/not valid/);
  });

  it("propagates a store failure", async () => {
    const blob = makeFakeBlob();
    blob.failNextPuts = 1;
    await expect(uploadAudio(blob, { digestId: "2026-10-07", audio })).rejects.toThrow(
      "blob store unavailable",
    );
  });
});

describe("pruneAudio", () => {
  it("deletes narrations older than the cutoff and keeps newer ones", async () => {
    const blob = makeFakeBlob();
    blob.seed("audio/2026-08-01.mp3", daysAgo(67));
    blob.seed("audio/2026-09-20.mp3", daysAgo(17));
    blob.seed("audio/2026-10-05.mp3", daysAgo(2));
    const result = await pruneAudio(blob, { olderThanDays: 30, now: NOW });
    expect(result).toEqual({ deleted: ["audio/2026-08-01.mp3"], kept: 2 });
    expect([...blob.store.keys()]).toEqual(["audio/2026-09-20.mp3", "audio/2026-10-05.mp3"]);
  });

  it("treats a blob exactly at the cutoff as kept", async () => {
    const blob = makeFakeBlob();
    blob.seed("audio/2026-09-07.mp3", daysAgo(30));
    expect((await pruneAudio(blob, { olderThanDays: 30, now: NOW })).deleted).toEqual([]);
  });

  it("only touches audio/*.mp3, however old other blobs are", async () => {
    const blob = makeFakeBlob();
    blob.seed("audio/2026-01-01.mp3", daysAgo(200));
    blob.seed("audio/notes.txt", daysAgo(200));
    blob.seed("covers/2026-01-01.png", daysAgo(200));
    blob.seed("audio.mp3", daysAgo(200));
    const result = await pruneAudio(blob, { olderThanDays: 1, now: NOW });
    expect(result.deleted).toEqual(["audio/2026-01-01.mp3"]);
    expect([...blob.store.keys()].sort()).toEqual([
      "audio.mp3",
      "audio/notes.txt",
      "covers/2026-01-01.png",
    ]);
  });

  // Bug: word marks and an episode's Opus manifest were never pruned, so they stayed for good.
  it("also prunes the .json files that travel with a narration", async () => {
    const blob = makeFakeBlob();
    blob.seed("audio/ep-20260101-0600/seg/t1.0123456789ab.marks.json", daysAgo(200));
    blob.seed("audio/ep-20260101-0600/episode.0123456789ab.json", daysAgo(200));
    blob.seed("audio/ep-20261005-0600/seg/t1.0123456789ab.marks.json", daysAgo(2));
    const result = await pruneAudio(blob, { olderThanDays: 30, now: NOW });
    expect(result.deleted).toHaveLength(2);
    expect([...blob.store.keys()]).toEqual([
      "audio/ep-20261005-0600/seg/t1.0123456789ab.marks.json",
    ]);
  });

  it("sweeps on Sundays only, so the daily audio run does not list all of audio/", () => {
    expect(isPruneDay(new Date("2026-11-01T06:00:00Z"))).toBe(true);
    expect(isPruneDay(new Date("2026-10-31T06:00:00Z"))).toBe(false);
  });

  it("lists with the audio/ prefix", async () => {
    const blob = makeFakeBlob();
    const seen: string[] = [];
    const list = blob.list.bind(blob);
    blob.list = async (options) => {
      seen.push(options.prefix);
      return list(options);
    };
    await pruneAudio(blob, { olderThanDays: 5, now: NOW });
    expect(seen).toEqual([AUDIO_PREFIX]);
  });

  it("follows pagination to the last page", async () => {
    const blob = makeFakeBlob(2);
    for (let day = 1; day <= 7; day++) blob.seed(`audio/2026-05-0${day}.mp3`, daysAgo(150));
    const result = await pruneAudio(blob, { olderThanDays: 30, now: NOW });
    expect(result.deleted).toHaveLength(7);
    expect(blob.store.size).toBe(0);
  });

  it("deletes in batches of 50", async () => {
    const blob = makeFakeBlob();
    for (let index = 0; index < 120; index++) {
      blob.seed(`audio/2025-01-01-${String(index + 2)}.mp3`, daysAgo(400));
    }
    await pruneAudio(blob, { olderThanDays: 30, now: NOW });
    expect(blob.deletes.map((batch) => batch.length)).toEqual([50, 50, 20]);
  });

  it("makes no delete call when nothing is old enough", async () => {
    const blob = makeFakeBlob();
    blob.seed("audio/2026-10-06.mp3", daysAgo(1));
    await pruneAudio(blob, { olderThanDays: 30, now: NOW });
    expect(blob.deletes).toEqual([]);
  });

  it.each([0, -3, 1.5, Number.NaN])(
    "refuses an age of %s days, which could wipe everything",
    async (days) => {
      const blob = makeFakeBlob();
      blob.seed("audio/2026-10-06.mp3", daysAgo(1));
      await expect(pruneAudio(blob, { olderThanDays: days, now: NOW })).rejects.toThrow(
        /whole number of days/,
      );
      expect(blob.deletes).toEqual([]);
    },
  );

  it("propagates a listing failure without deleting", async () => {
    const blob = makeFakeBlob();
    blob.seed("audio/2025-01-01.mp3", daysAgo(400));
    blob.failList = new Error("list failed");
    await expect(pruneAudio(blob, { olderThanDays: 30, now: NOW })).rejects.toThrow("list failed");
    expect(blob.deletes).toEqual([]);
  });
});
