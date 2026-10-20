import { describe, expect, it } from "vitest";
import { addDownload, type Download, MAX_DOWNLOADS, parseDownloads } from "./downloads";

const item = (id: string): Download => ({ id, audio: `/${id}.mp3`, page: `/d/${id}`, extras: [] });

describe("downloads", () => {
  it("removes the oldest download once there are more than the limit", () => {
    let list: Download[] = [];
    let evicted: Download[] = [];
    for (let n = 1; n <= MAX_DOWNLOADS + 2; n += 1) {
      ({ list, evicted } = addDownload(list, item(`d${n}`)));
    }
    expect(list.map((entry) => entry.id)).toEqual(
      Array.from({ length: MAX_DOWNLOADS }, (_, n) => `d${n + 3}`),
    );
    expect(evicted.map((entry) => entry.id)).toEqual(["d2"]);
  });

  it("counts a download made again as the newest, not as a second copy", () => {
    const first = addDownload([], item("a")).list;
    const both = addDownload(first, item("b")).list;
    const again = addDownload(both, item("a"), 2);
    expect(again.list.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(again.evicted).toEqual([]);
  });

  it("reads a damaged list as empty instead of failing the Library", () => {
    expect(parseDownloads("not json")).toEqual([]);
    expect(parseDownloads(JSON.stringify([{ id: 1 }, item("ok")]))).toEqual([item("ok")]);
  });
});
