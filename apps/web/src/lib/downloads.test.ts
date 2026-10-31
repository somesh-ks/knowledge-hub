import { describe, expect, it } from "vitest";
import {
  addDownload,
  confirmLookup,
  type Download,
  parseDownloads,
  segmentUrls,
} from "./downloads";

const item = (id: string): Download => ({ id, audio: `/${id}.mp3`, page: `/d/${id}`, extras: [] });

describe("downloads", () => {
  it("counts a download made again as the newest, not as a second copy", () => {
    const first = addDownload([], item("a"));
    const both = addDownload(first, item("b"));
    const again = addDownload(both, item("a"));
    expect(again.map((entry) => entry.id)).toEqual(["b", "a"]);
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
});
