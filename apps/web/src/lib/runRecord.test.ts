import { describe, expect, it } from "vitest";
import {
  claimEndCue,
  endedRecently,
  isBriefingGoing,
  type RunRecord,
  readRunRecord,
} from "./runRecord";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
};

describe("a briefing run's end cue", () => {
  it("plays once for each end, however often the indicator redraws or the island is mounted again", () => {
    const session = memory();
    const done: RunRecord = { id: 9, phase: "done", what: "briefing" };
    expect(claimEndCue(done, session)).toBe("finished");
    expect(claimEndCue(done, session)).toBeNull();
    expect(claimEndCue({ id: 10, phase: "failed", what: "briefing" }, session)).toBe("failed");
  });

  // A browser with site data blocked throws on touching localStorage itself, before any read: the
  // island's wake and the cue must treat that as "no run remembered", as the wake always did.
  it("treats blocked storage as no run and no cue, instead of throwing", () => {
    const blocked = (): never => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(readRunRecord(blocked)).toBeNull();
    expect(claimEndCue({ id: 9, phase: "done", what: "briefing" }, blocked)).toBe("finished");
  });

  it("is not owed for an episode or a run that is still going", () => {
    const session = memory();
    expect(claimEndCue({ id: 9, phase: "done" }, session)).toBeNull();
    expect(claimEndCue({ id: 9, phase: "running", what: "briefing" }, session)).toBeNull();
    expect(isBriefingGoing({ id: 9, phase: "running", what: "briefing" })).toBe(true);
    expect(isBriefingGoing({ id: 9, phase: "running" })).toBe(false);
  });
});

// The island hydrates on a wake (islandWake.ts) and can come up after the first status answer: a run
// that ended in that gap sent its event to nobody and never got its cue (CodeRabbit, PR 391). The
// island looks once when it mounts, and must not replay a run that ended before the page opened.
describe("a briefing run that ended while the island was loading", () => {
  const now = 2_000_000_000_000;

  it("is announced on mount, and one that ended long before the page opened is not", () => {
    expect(
      endedRecently({ id: 9, phase: "done", what: "briefing", stageAt: now - 2_000 }, now),
    ).toBe(true);
    expect(
      endedRecently({ id: 9, phase: "failed", what: "briefing", stageAt: now - 3_600_000 }, now),
    ).toBe(false);
    expect(endedRecently({ id: 9, phase: "done", what: "briefing" }, now)).toBe(false);
    expect(endedRecently(null, now)).toBe(false);
  });
});
