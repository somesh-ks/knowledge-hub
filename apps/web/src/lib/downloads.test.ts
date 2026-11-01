import { describe, expect, it } from "vitest";
import {
  addDownload,
  confirmLookup,
  type Download,
  parseDownloads,
  segmentUrls,
  unlistedPayloads,
} from "./downloads";

const item = (id: string): Download => ({ id, audio: `/${id}.mp3`, page: `/d/${id}`, extras: [] });

describe("downloads", () => {
  it("counts a download made again as the newest, not as a second copy", () => {
    const first = addDownload([], item("a"));
    const both = addDownload(first, item("b"));
    const again = addDownload(both, item("a"));
    expect(again.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("keeps every download, oldest first, however many there are", () => {
    let list: Download[] = [];
    for (let n = 1; n <= 12; n += 1) list = addDownload(list, item(`d${n}`));
    expect(list.map((entry) => entry.id)).toEqual(
      Array.from({ length: 12 }, (_, n) => `d${n + 1}`),
    );
  });

  it("reads a damaged list as empty instead of failing the Library", () => {
    expect(parseDownloads("not json")).toEqual([]);
    expect(parseDownloads(JSON.stringify([{ id: 1 }, item("ok")]))).toEqual([item("ok")]);
  });

  it("saves an episode's lookup as confirmed so offline Play never asks to narrate, and refuses a turn with no address", () => {
    const lookup = {
      segments: [
        { key: "t0", audio: { url: "/a/t0.mp3", confirmed: false } },
        { key: "t1", audio: { url: "/a/t1.mp3", confirmed: false } },
      ],
    };
    expect(segmentUrls(lookup)).toEqual([
      { key: "t0", url: "/a/t0.mp3" },
      { key: "t1", url: "/a/t1.mp3" },
    ]);
    const saved = confirmLookup(lookup) as typeof lookup;
    expect(saved.segments.every((segment) => segment.audio.confirmed === true)).toBe(true);
    expect(segmentUrls({ segments: [{ key: "t0", audio: null }] })).toBeNull();
  });

  // Bug: a page killed mid-save left cached audio no entry named; the worker served it offline and
  // removeDownload (listed entries only) never deleted it, so it held the quota for good (PWA-01).
  it("finds the audio, marks and lookups no download names, and leaves pages and named files", () => {
    const origin = "https://news.example.com";
    const named: Download = {
      id: "ep-1",
      audio: "/api/narrate?digest=ep-1",
      page: "/e/ep-1",
      extras: ["https://blob.example.com/audio/ep-1/seg/t0.0123456789ab.mp3"],
    };
    const keys = [
      `${origin}/e/ep-1`,
      `${origin}/api/narrate?digest=ep-1`,
      "https://blob.example.com/audio/ep-1/seg/t0.0123456789ab.mp3",
      "https://blob.example.com/audio/ep-2/seg/t0.aaaaaaaaaaaa.mp3",
      `${origin}/api/narrate-marks?digest=ep-2&segment=t0`,
      `${origin}/api/narrate?digest=ep-2`,
      `${origin}/d/2026-10-30`,
      `${origin}/_astro/app.js`,
      `${origin}/covers/ep-2-512.webp`,
    ];
    expect(unlistedPayloads(keys, [named], origin)).toEqual([
      "https://blob.example.com/audio/ep-2/seg/t0.aaaaaaaaaaaa.mp3",
      `${origin}/api/narrate-marks?digest=ep-2&segment=t0`,
      `${origin}/api/narrate?digest=ep-2`,
    ]);
  });
});
