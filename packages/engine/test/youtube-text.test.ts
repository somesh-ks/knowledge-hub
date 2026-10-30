import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVideoText, withVideoText } from "../src/extract/youtubeText.js";
import { FirecrawlGuard } from "../src/fetch/firecrawlBudget.js";
import { makeItem } from "./score-factories.js";

const speech = "Today we look at the new release and what it changes for designers. ".repeat(6);
const video = makeItem({
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  source_type: "youtube",
  snippet: "short",
});

function fakeNet() {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url.startsWith("https://generativelanguage") ? "gemini" : "firecrawl");
    if (url.startsWith("https://generativelanguage")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: speech }] } }] });
    }
    return Response.json({
      success: true,
      data: {
        creditsCost: 5,
        alexandria: [{ data: { has_transcript: true, full_text: speech } }],
      },
    });
  }) as typeof fetch;
  return { fn, calls };
}

describe("YouTube video text", () => {
  it("reads captions through Firecrawl first, transcribes only without them, and never repeats a video", async () => {
    const cachePath = join(mkdtempSync(join(tmpdir(), "video-text-")), "video-text.json");
    const relayed = fakeNet();
    const first = createVideoText({
      apiKey: "k",
      models: async () => ["m"],
      cachePath,
      fetchImpl: relayed.fn,
      firecrawl: { apiKey: "fc" },
    });
    expect((await first(video))?.method).toBe("captions");
    expect(relayed.calls).toEqual(["firecrawl"]);

    const again = fakeNet();
    const second = createVideoText({
      apiKey: "k",
      models: async () => ["m"],
      cachePath,
      fetchImpl: again.fn,
      firecrawl: { apiKey: "fc" },
    });
    expect((await second(video))?.method).toBe("captions");
    expect(again.calls).toEqual([]);

    const none = fakeNet();
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
    expect(none.calls).toEqual(["gemini"]);
  });

  it("captions come through Firecrawl from the scrape budget, and Gemini is asked only once that budget is spent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-text-"));
    const guard = new FirecrawlGuard(undefined, { ceiling: 1, listing: 0 });
    const credits: number[] = [];
    const blocked = fakeNet();
    const read = createVideoText({
      apiKey: "k",
      models: async () => ["m"],
      cachePath: join(dir, "video-text.json"),
      fetchImpl: blocked.fn,
      firecrawl: { apiKey: "fc", guard, onCredits: (spent) => credits.push(spent) },
    });
    expect((await read(video))?.method).toBe("captions");
    expect(blocked.calls).toContain("firecrawl");
    expect(blocked.calls).not.toContain("gemini");
    expect(credits).toEqual([5]);

    // The one scrape of the budget is spent: the next video is transcribed, not relayed.
    const other = makeItem({
      url: "https://www.youtube.com/watch?v=zzzzzzzzzzz",
      source_type: "youtube",
    });
    expect((await read(other))?.method).toBe("transcription");
    expect(blocked.calls.filter((call) => call === "firecrawl")).toHaveLength(1);
  });

  it("falls back to the description, or nothing, when captions and transcription both fail", async () => {
    const cachePath = join(mkdtempSync(join(tmpdir(), "video-text-")), "c.json");
    const none = fakeNet();
    const general = vi.fn(async () => null);
    const extract = withVideoText(general, createVideoText({ cachePath, fetchImpl: none.fn }));
    expect(await extract(video)).toBeNull();
    const described = makeItem({ ...video, snippet: "d".repeat(300) });
    expect((await extract(described))?.method).toBe("snippet");
    expect(general).not.toHaveBeenCalled();
  });

  it("counts every paid transcription attempt against the cap, and stops at a short answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-text-"));
    const gemini = { calls: 0, reply: (): string | null => null };
    const fetchImpl = (async () => {
      gemini.calls += 1;
      return Response.json({ candidates: [{ content: { parts: [{ text: gemini.reply() }] } }] });
    }) as typeof fetch;
    const make = (maxTranscriptions: number) =>
      createVideoText({
        apiKey: "k",
        models: async () => ["a", "b"],
        cachePath: join(dir, `${maxTranscriptions}.json`),
        fetchImpl,
        maxTranscriptions,
      });
    const other = (id: string) =>
      makeItem({ url: `https://www.youtube.com/watch?v=${id}`, source_type: "youtube" });

    // A short answer was paid for: the second model is not tried.
    gemini.reply = () => "too short";
    expect(await make(5)(other("aaaaaaaaaaa"))).toBeNull();
    expect(gemini.calls).toBe(1);

    // Both models fail on the first video; the cap of two is spent, so the next video costs nothing.
    gemini.calls = 0;
    gemini.reply = () => {
      throw new Error("down");
    };
    const capped = make(2);
    await capped(other("bbbbbbbbbbb"));
    await capped(other("ccccccccccc"));
    expect(gemini.calls).toBe(2);
  });
});
