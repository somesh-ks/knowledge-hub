import { describe, expect, it } from "vitest";
import { cardProgress } from "./cardProgress";
import {
  createHeardTracker,
  fabLabel,
  idleBriefingChip,
  itemVisualState,
  rememberedChip,
  storyChipView,
} from "./readerMath";
import {
  HEARD_KEY_PREFIX,
  playedKey,
  readRemembered,
  resumeKey,
  type StorageLike,
  saveHeard,
} from "./resume";

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("the stories heard, remembered beside the position", () => {
  it("writes the ids when the set changes and forgets the key when it empties", () => {
    const storage = memory();
    saveHeard(storage, "2026-10-07", ["a1", "b2"]);
    expect(storage.getItem(`${HEARD_KEY_PREFIX}2026-10-07`)).toBe("a1 b2");
    saveHeard(storage, "2026-10-07", []);
    expect(storage.map.has(`${HEARD_KEY_PREFIX}2026-10-07`)).toBe(false);
  });

  it("reads them back beside a position or the end", () => {
    const storage = memory();
    saveHeard(storage, "x", ["a1", "b2"]);
    storage.setItem(resumeKey("x"), "40");
    expect(readRemembered(storage, "x")).toEqual({
      seconds: 40,
      played: false,
      heard: ["a1", "b2"],
    });
    storage.removeItem(resumeKey("x"));
    storage.setItem(playedKey("x"), "1");
    expect(readRemembered(storage, "x").heard).toEqual(["a1", "b2"]);
  });

  it("ignores them when the recording restarted (no position and not played)", () => {
    const storage = memory();
    saveHeard(storage, "x", ["a1"]);
    expect(readRemembered(storage, "x")).toEqual({ seconds: 0, played: false, heard: [] });
  });

  it("is best effort when storage throws or is missing", () => {
    expect(() => saveHeard(throwing, "x", ["a1"])).not.toThrow();
    expect(readRemembered(throwing, "x")).toEqual({ seconds: 0, played: false, heard: [] });
    expect(readRemembered(null, "x")).toEqual({ seconds: 0, played: false, heard: [] });
  });

  it("seeds the tracker, and a replay after the end starts afresh", () => {
    const tracker = createHeardTracker();
    tracker.reset(4, [0, 1, 2, 3]);
    expect([...tracker.heard]).toEqual([0, 1, 2, 3]);
    tracker.moved(5, "auto");
    expect(tracker.heard.has(4)).toBe(true);

    tracker.reset(0, [0, 2], true);
    expect([...tracker.heard]).toEqual([0, 2]);
    tracker.moved(1, "auto");
    expect(tracker.heard.size).toBe(0);
  });
});

describe("a failed story", () => {
  it("is not current, keeps its heard mark, and its chip shows its length", () => {
    const heard = new Set([0]);
    expect(itemVisualState(1, true, 1, false, heard, true)).toBe("");
    expect(itemVisualState(0, true, 0, false, heard, true)).toBe("played");
    expect(itemVisualState(1, true, 1, false, heard)).toBe("current");
    const chip = storyChipView(
      itemVisualState(1, true, 1, false, heard, true),
      false,
      false,
      "0:24",
      "H",
    );
    expect(chip.label).toBe("0:24");
    expect(chip.state).toBe("idle");
  });
});

describe("a briefing without audio, from its page's estimate", () => {
  it("offers the time left, Played, or its length", () => {
    expect(rememberedChip({ seconds: 60, played: false, heard: [] }, 180, "briefing")).toEqual({
      state: "idle",
      playing: false,
      label: "2 min left",
      name: "Resume the briefing, 2 min left",
    });
    expect(rememberedChip({ seconds: 0, played: true, heard: [] }, 180, "briefing").label).toBe(
      "Played",
    );
    expect(rememberedChip(undefined, 180, "briefing")).toEqual(idleBriefingChip("3 min"));
  });
});

describe("the floating Play button", () => {
  it("says the chip's words after its verb", () => {
    expect(fabLabel(idleBriefingChip("5 min"))).toBe("Play · 5 min");
    expect(
      fabLabel(rememberedChip({ seconds: 120, played: false, heard: [] }, 180, "briefing")),
    ).toBe("Resume · 1 min left");
    expect(fabLabel(rememberedChip({ seconds: 0, played: true, heard: [] }, 180, "briefing"))).toBe(
      "Played",
    );
  });
});

describe("a card's progress", () => {
  it("shows a bar for a half-heard card", () => {
    expect(cardProgress({ seconds: 90, played: false, heard: [] }, 3)).toEqual({
      share: 0.5,
      played: false,
    });
  });
  it("says Played for a finished card", () => {
    expect(cardProgress({ seconds: 0, played: true, heard: [] }, 3)).toEqual({
      share: 0,
      played: true,
    });
  });
  it("says nothing when nothing is remembered, or the length is unknown", () => {
    expect(cardProgress({ seconds: 0, played: false, heard: [] }, 3)).toEqual({
      share: 0,
      played: false,
    });
    expect(cardProgress({ seconds: 50, played: false, heard: [] }, Number.NaN).share).toBe(0);
  });
  it("ignores a bad stored value", () => {
    const storage = memory();
    storage.setItem(resumeKey("x"), "soon");
    expect(cardProgress(readRemembered(storage, "x"), 3)).toEqual({ share: 0, played: false });
  });
});
