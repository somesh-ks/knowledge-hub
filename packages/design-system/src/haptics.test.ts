import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHaptics } from "./haptics";
import { HAPTIC_INTENTS, HAPTIC_PATTERNS } from "./hapticTokens";

describe("haptics", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a success's second tick does not land after Haptics is turned off, and a scrub's burst of detents buzzes once a gap, not on every row", () => {
    let on = true;
    const ticks: number[] = [];
    let clock = 0;
    const haptics = createHaptics({
      support: "ios",
      isEnabled: () => on,
      tick: () => ticks.push(clock),
      now: () => clock,
    });

    // Done: two ticks, 90 ms apart. The person turns Haptics off between them.
    expect(haptics.fire("success")).toBe(true);
    on = false;
    haptics.cancel();
    vi.advanceTimersByTime(500);
    expect(ticks).toEqual([0]);

    // A fast drag passes a row every 10 ms: one tick per 40 ms, never one per row.
    on = true;
    ticks.length = 0;
    clock = 1000;
    let fired = 0;
    for (let row = 0; row < 20; row += 1) {
      clock += 10;
      if (haptics.fire("detent")) fired += 1;
    }
    expect(fired).toBe(5);
  });

  it("asks Android for the token's milliseconds and stays quiet for an intent with no pattern", () => {
    const vibrate = vi.fn();
    const haptics = createHaptics({
      support: "android",
      isEnabled: () => true,
      vibrate,
      now: () => 0,
    });
    expect(haptics.fire("close")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    expect(haptics.fire("success")).toBe(true);
    // The token's own pulses, whatever their lengths: a retune of the milliseconds is not this test's.
    expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS[HAPTIC_INTENTS.success].android]);
  });
});
