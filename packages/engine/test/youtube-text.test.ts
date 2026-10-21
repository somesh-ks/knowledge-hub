import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVideoText, withVideoText } from "../src/extract/youtubeText.js";
import { makeItem } from "./score-factories.js";

const speech = "Today we look at the new release and what it changes for designers. ".repeat(6);
const track = {
  baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en",
  languageCode: "en",
  kind: "asr",
};
const video = makeItem({
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  source_type: "youtube",
  snippet: "short",
});

function fakeNet(opts: { captions: boolean }) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url.startsWith("https://generativelanguage") ? "gemini" : url);
    if (url.startsWith("https://generativelanguage")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: speech }] } }] });
    }
    if (url.includes("/youtubei/v1/player")) {
      const captionTracks = opts.captions ? [track] : [];
      return Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks } } });
    }
    return Response.json({ events: [{ segs: [{ utf8: speech }] }] });
  }) as typeof fetch;
  return { fn, calls };
}

describe("YouTube video text", () => {
  it("reads captions first, transcribes only without them, and never repeats a video", async () => {
    const cachePath = join(mkdtempSync(join(tmpdir(), "video-text-")), "video-text.json");
    const withCaptions = fakeNet({ captions: true });
    const first = createVideoText({
      apiKey: "k",
      models: async () => ["m"],
      cachePath,
      fetchImpl: withCaptions.fn,
    });
    expect((await first(video))?.method).toBe("captions");
    expect(withCaptions.calls).not.toContain("gemini");

    const again = fakeNet({ captions: true });
    const second = createVideoText({
      apiKey: "k",
      models: async () => ["m"],
      cachePath,
      fetchImpl: again.fn,
    });
    expect((await second(video))?.method).toBe("captions");
    expect(again.calls).toEqual([]);

    const none = fakeNet({ captions: false });
    const other = makeItem({
      url: "https://www.youtube.com/watch?v=zzzzzzzzzzz",
      source_type: "youtube",
    });
    const third = createVideoText({
      apiKey: "k",
      models: async () => ["m"],
      cachePath,
      fetchImpl: none.fn,
    });
    expect((await third(other))?.method).toBe("transcription");
    expect(none.calls).toContain("gemini");
  });

  it("falls back to the description, or nothing, when captions and transcription both fail", async () => {
    const cachePath = join(mkdtempSync(join(tmpdir(), "video-text-")), "c.json");
    const none = fakeNet({ captions: false });
    const general = vi.fn(async () => null);
    const extract = withVideoText(general, createVideoText({ cachePath, fetchImpl: none.fn }));
    expect(await extract(video)).toBeNull();
    const described = makeItem({ ...video, snippet: "d".repeat(300) });
    expect((await extract(described))?.method).toBe("snippet");
    expect(general).not.toHaveBeenCalled();
  });
});
