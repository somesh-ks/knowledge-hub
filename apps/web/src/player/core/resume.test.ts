import { describe, expect, it } from "vitest";
import {
  clearResumePosition,
  PLAYED_KEY_PREFIX,
  playedKey,
  resumeKey,
  type StorageLike,
  saveResumePosition,
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

describe("played", () => {
  it("uses the key the Library reads", () => {
    expect(PLAYED_KEY_PREFIX).toBe("dispatch:played:");
    expect(playedKey("2026-10-07")).toBe("dispatch:played:2026-10-07");
  });

  it("marks an item played when its position reaches the end, and forgets the position", () => {
    const storage = memory();
    saveResumePosition(storage, "2026-10-07", 60, 120);
    expect(storage.getItem(resumeKey("2026-10-07"))).toBe("60");
    expect(storage.getItem(playedKey("2026-10-07"))).toBeNull();
    saveResumePosition(storage, "2026-10-07", 119, 120);
    expect(storage.getItem(resumeKey("2026-10-07"))).toBeNull();
    expect(storage.getItem(playedKey("2026-10-07"))).not.toBeNull();
  });

  it("marks an item played when it ends", () => {
    const storage = memory();
    storage.setItem(resumeKey("ep-1"), "40");
    clearResumePosition(storage, "ep-1");
    expect(storage.getItem(resumeKey("ep-1"))).toBeNull();
    expect(storage.getItem(playedKey("ep-1"))).not.toBeNull();
  });

  it("drops Played once a new position is saved", () => {
    const storage = memory();
    clearResumePosition(storage, "ep-1");
    // Started again but barely: still played.
    saveResumePosition(storage, "ep-1", 1, 120);
    expect(storage.getItem(playedKey("ep-1"))).not.toBeNull();
    saveResumePosition(storage, "ep-1", 30, 120);
    expect(storage.getItem(resumeKey("ep-1"))).toBe("30");
    expect(storage.getItem(playedKey("ep-1"))).toBeNull();
  });

  it("does not throw when storage does", () => {
    const failing: StorageLike = {
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
    expect(() => clearResumePosition(failing, "ep-1")).not.toThrow();
    expect(() => saveResumePosition(failing, "ep-1", 119, 120)).not.toThrow();
  });
});
