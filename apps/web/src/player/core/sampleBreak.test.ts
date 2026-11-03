import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginBreak, FADE_IN_MS, FADE_OUT_MS } from "./sampleBreak";
import { createHarness, makeDigest } from "./testing";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function playing(): ReturnType<typeof createHarness> {
  const harness = createHarness();
  harness.store.load(makeDigest());
  harness.audio.loadMetadata(120);
  harness.store.play();
  harness.audio.startPlaying();
  return harness;
}

/** A speaker that obeys its volume, as a desktop or Android browser does. */
const obeying = () => ({ volume: 0.8 });

/** One that ignores it, as iOS does. */
function ignoring(): { volume: number } {
  return {
    get volume() {
      return 1;
    },
    set volume(_value: number) {},
  };
}

describe("a voice sample over a playing podcast", () => {
  it("fades the podcast out, pauses it quietly, and brings it back where it was", () => {
    const harness = playing();
    const speaker = obeying();
    const started = vi.fn();
    const brk = beginBreak({ store: harness.store, speaker });
    expect(brk).not.toBeNull();
    brk?.afterFade(started);
    // Still playing, and getting quieter: the sample waits.
    vi.advanceTimersByTime(FADE_OUT_MS / 2);
    expect(harness.store.getState().status).toBe("playing");
    expect(speaker.volume).toBeLessThan(0.8);
    expect(started).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FADE_OUT_MS);
    // Paused by us: no "Paused by another app", and the volume is given back for the next play.
    expect(harness.store.getState()).toMatchObject({ status: "paused", interrupted: false });
    expect(speaker.volume).toBe(0.8);
    expect(started).toHaveBeenCalledTimes(1);
    expect(harness.events).toContainEqual({ type: "didPause", reason: "system" });

    brk?.end();
    expect(speaker.volume).toBe(0);
    harness.audio.startPlaying();
    vi.advanceTimersByTime(FADE_IN_MS + 100);
    expect(harness.store.getState().status).toBe("playing");
    expect(speaker.volume).toBe(0.8);
  });

  it("leaves a podcast the listener had paused alone", () => {
    const harness = playing();
    harness.store.pause("user");
    expect(beginBreak({ store: harness.store, speaker: obeying() })).toBeNull();
  });

  it("does not take the podcast back from a listener who pressed Play during the sample", () => {
    const harness = playing();
    const speaker = obeying();
    const brk = beginBreak({ store: harness.store, speaker });
    vi.advanceTimersByTime(FADE_OUT_MS * 2);
    harness.store.play("user");
    harness.audio.startPlaying();
    expect(brk?.over).toBe(true);
    const pauses = harness.audio.pauseCalls;
    brk?.end();
    expect(harness.audio.pauseCalls).toBe(pauses);
    expect(harness.store.getState().status).toBe("playing");
    expect(speaker.volume).toBe(0.8);
  });

  it("lets the podcast play on when the sample stops before the fade is done", () => {
    const harness = playing();
    const speaker = obeying();
    const brk = beginBreak({ store: harness.store, speaker });
    vi.advanceTimersByTime(FADE_OUT_MS / 2);
    brk?.end();
    vi.advanceTimersByTime(FADE_OUT_MS * 2);
    expect(harness.store.getState().status).toBe("playing");
    expect(speaker.volume).toBe(0.8);
  });

  it("pauses at once where the browser ignores volume, so the sample starts inside the tap", () => {
    const harness = playing();
    const started = vi.fn();
    const brk = beginBreak({ store: harness.store, speaker: ignoring() });
    brk?.afterFade(started);
    expect(started).toHaveBeenCalledTimes(1);
    expect(harness.store.getState().status).toBe("paused");
  });
});
