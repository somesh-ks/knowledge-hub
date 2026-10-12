import { describe, expect, it, vi } from "vitest";
import { claimPrewarm, pageNeedsPrewarm, prewarmAllowed, whenIdle } from "./prewarmPage";

describe("pageNeedsPrewarm", () => {
  it("is only for a page with a briefing or an episode and no audio, online", () => {
    expect(pageNeedsPrewarm({ audio: null }, true)).toBe(true);
    // A page without a briefing (the Library, Settings) loads no narration code.
    expect(pageNeedsPrewarm(null, true)).toBe(false);
    expect(pageNeedsPrewarm({ audio: { url: "/a.mp3" } }, true)).toBe(false);
    expect(pageNeedsPrewarm({ audio: null }, false)).toBe(false);
  });
});

describe("whenIdle", () => {
  it("waits for the browser's idle moment, with a bound, instead of a fixed delay", () => {
    const work = vi.fn();
    const requestIdleCallback = vi.fn((run: () => void) => run());
    const setTimeout = vi.fn();
    whenIdle(work, { requestIdleCallback, setTimeout });
    expect(requestIdleCallback).toHaveBeenCalledWith(work, { timeout: 3_000 });
    expect(setTimeout).not.toHaveBeenCalled();
    expect(work).toHaveBeenCalledOnce();
  });

  it("runs on the next turn where there is no idle callback", () => {
    const setTimeout = vi.fn();
    const work = vi.fn();
    whenIdle(work, { setTimeout });
    expect(setTimeout).toHaveBeenCalledWith(work, 0);
  });
});

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("claimPrewarm", () => {
  it("lets a page through once per session", () => {
    const storage = memory();
    expect(claimPrewarm(storage, "2026-10-07")).toBe(true);
    expect(claimPrewarm(storage, "2026-10-07")).toBe(false);
    expect(claimPrewarm(storage, "ep-1")).toBe(true);
  });

  it("says no when storage is missing or throws", () => {
    expect(claimPrewarm(null, "x")).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(claimPrewarm(broken, "x")).toBe(false);
  });
});

describe("prewarmAllowed", () => {
  it("holds back for a hidden tab, saved data and no connection", () => {
    expect(prewarmAllowed({ hidden: false, saveData: false, online: true })).toBe(true);
    expect(prewarmAllowed({ hidden: true, saveData: false, online: true })).toBe(false);
    expect(prewarmAllowed({ hidden: false, saveData: true, online: true })).toBe(false);
    expect(prewarmAllowed({ hidden: false, saveData: false, online: false })).toBe(false);
  });
});
