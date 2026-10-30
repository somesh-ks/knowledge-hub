import { describe, expect, it } from "vitest";
import { claimEnd, endedRecently, isRunGoing, type RunRecord, readRunRecord } from "./runRecord";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
};

describe("how a run's end is told", () => {
  it("is told once for each end, however often the indicator redraws or the island is mounted again, with a sound for a podcast only", () => {
    const session = memory();
    const done: RunRecord = { id: 9, phase: "done", what: "briefing" };
    expect(claimEnd(done, session)).toEqual({ ended: "finished", sound: true });
    expect(claimEnd(done, session)).toBeNull();
    expect(claimEnd({ id: 10, phase: "failed", what: "briefing" }, session)).toEqual({
      ended: "failed",
      sound: true,
    });
    // An episode's end is a toast without a sound: the queue lets go of it, so the toast is how it is found.
    expect(claimEnd({ id: 11, phase: "done" }, session)).toEqual({
      ended: "finished",
      sound: false,
    });
  });

  // A browser with site data blocked throws on touching localStorage itself, before any read: the
  // island's wake and the cue must treat that as "no run remembered", as the wake always did.
  it("treats blocked storage as no run and no cue, instead of throwing", () => {
    const blocked = (): never => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(readRunRecord(blocked)).toBeNull();
    expect(claimEnd({ id: 9, phase: "done", what: "briefing" }, blocked)?.ended).toBe("finished");
  });

  it("is not owed for a run that is still going, and a removal is not a run being made", () => {
    const session = memory();
    expect(claimEnd({ id: 9, phase: "running", what: "briefing" }, session)).toBeNull();
    expect(isRunGoing({ id: 9, phase: "running", what: "briefing" })).toBe(true);
    expect(isRunGoing({ id: 9, phase: "updating" })).toBe(true);
    expect(isRunGoing({ id: 9, phase: "running", kind: "delete" })).toBe(false);
    expect(isRunGoing({ id: 9, phase: "failed" })).toBe(false);
    expect(isRunGoing(null)).toBe(false);
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

  // A tab opened seconds after a run ended has no cue claim of its own, and played the sound again
  // (CodeRabbit, PR 391, third round): the run must have ended after this page began.
  it("is not announced in a page that opened after the run ended", () => {
    const run: RunRecord = { id: 9, phase: "done", what: "briefing", stageAt: now - 10_000 };
    expect(endedRecently(run, now, now - 5_000)).toBe(false);
    expect(endedRecently(run, now, now - 20_000)).toBe(true);
  });
});
