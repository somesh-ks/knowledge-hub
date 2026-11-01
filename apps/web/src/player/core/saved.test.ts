import { describe, expect, it } from "vitest";
import type { StorageLike } from "./resume";
import { isSaved, savedKey, setSaved } from "./saved";

function memory(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("saved podcasts", () => {
  it("keeps one key per item, which the Saved page reads", () => {
    expect(savedKey("2026-10-07")).toBe("singularity:saved:2026-10-07");
  });

  it("saves and forgets an item without touching another", () => {
    const storage = memory();
    expect(setSaved(storage, "a", true)).toBe(true);
    expect(isSaved(storage, "a")).toBe(true);
    expect(isSaved(storage, "b")).toBe(false);
    expect(setSaved(storage, "a", false)).toBe(false);
    expect(isSaved(storage, "a")).toBe(false);
  });

  it("says it did not save when storage refuses, as in a private window", () => {
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(setSaved(refusing, "a", true)).toBe(false);
    expect(isSaved(refusing, "a")).toBe(false);
    expect(setSaved(null, "a", true)).toBe(false);
  });
});
