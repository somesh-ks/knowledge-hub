import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWordMarks } from "./wordMarks";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadWordMarks", () => {
  it("asks once per segment and reads the marks", async () => {
    const words = [{ word: 0, start_ms: 0, end_ms: 250 }];
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 200, words })));
    vi.stubGlobal("fetch", fetch);
    expect(await loadWordMarks("ep-20261007-0900", "t1")).toEqual(words);
    expect(await loadWordMarks("ep-20261007-0900", "t1")).toEqual(words);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/narrate-marks?digest=ep-20261007-0900&segment=t1");
  });

  it("is null for a miss, a page instead of JSON, or a failed request, and does not ask again", async () => {
    const answers = [
      () => new Response("{}", { status: 404 }),
      () => new Response("<!doctype html><title>stub</title>"),
      () => {
        throw new TypeError("offline");
      },
    ];
    for (const [index, answer] of answers.entries()) {
      const fetch = vi.fn(async () => answer());
      vi.stubGlobal("fetch", fetch);
      expect(await loadWordMarks("ep-20261007-0900", `t${10 + index}`)).toBeNull();
      expect(await loadWordMarks("ep-20261007-0900", `t${10 + index}`)).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
