import { describe, expect, it } from "vitest";
import {
  clearResumePosition,
  PLAYED_KEY_PREFIX,
  playedKey,
  readRemembered,
  readResumePosition,
  recordingOf,
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
    expect(PLAYED_KEY_PREFIX).toBe("singularity:played:");
    expect(playedKey("2026-10-07")).toBe("singularity:played:2026-10-07");
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

  it("never reads the unlock primer's silence as the end of a recording", () => {
    const storage = memory();
    // A tap loads 0.05 s of silence so the phone lets the element start later; its position 0 is not
    // the end of that file, nor of the episode that is about to be narrated.
    saveResumePosition(storage, "ep-1", 0, 0.05);
    saveResumePosition(storage, "ep-1", 0, 3);
    expect(storage.getItem(playedKey("ep-1"))).toBeNull();
    expect(storage.getItem(resumeKey("ep-1"))).toBeNull();
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

describe("a rewritten recording", () => {
  // The bug it prevents (2026-11-06, the owner's phone): a rewrite keeps the digest's id, so its new
  // recording began where the old one was left, at 4 minutes, and the seek made Play wait.
  it("starts over where the recording it was saved for is gone, and forgets its Played", () => {
    const storage = memory();
    saveResumePosition(storage, "2026-11-05", 250, 300, "audio/2026-11-05.v1.mp3");
    expect(readResumePosition(storage, "2026-11-05", 330, "audio/2026-11-05.v1.mp3")).toBe(250);
    expect(readResumePosition(storage, "2026-11-05", 330, "audio/2026-11-05.v2.mp3")).toBe(0);
    expect(storage.getItem(resumeKey("2026-11-05"))).toBeNull();

    clearResumePosition(storage, "2026-11-05", "audio/2026-11-05.v2.mp3");
    expect(readRemembered(storage, "2026-11-05", 330, "audio/2026-11-05.v2.mp3").played).toBe(true);
    expect(readRemembered(storage, "2026-11-05", 330, "audio/2026-11-05.v3.mp3").played).toBe(
      false,
    );
  });

  it("names the recording by the file the browser tries first", () => {
    expect(recordingOf({ url: "a.mp3", m4a_url: "a.m4a" })).toBe("a.m4a");
    expect(recordingOf({ url: "a.mp3" })).toBe("a.mp3");
    expect(recordingOf(null)).toBeUndefined();
  });

  it("keeps memory written before the recording was noted, and a reader that does not know it", () => {
    const storage = memory();
    storage.setItem(resumeKey("2026-11-05"), "90");
    expect(readResumePosition(storage, "2026-11-05", 330, "audio/2026-11-05.v2.mp3")).toBe(90);
    saveResumePosition(storage, "2026-11-06", 60, 300, "audio/2026-11-06.v1.mp3");
    expect(readResumePosition(storage, "2026-11-06", 300)).toBe(60);
  });
});
