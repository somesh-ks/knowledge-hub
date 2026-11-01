import { describe, expect, it } from "vitest";
import { SWIPE_SPAN_PX, swipeFrame, swipeSwitches } from "./dockSwipe";

describe("the dock's sideways swipe", () => {
  it("never switches where nothing waits, and gives a little where it resists", () => {
    expect(swipeSwitches(-300, -2, false)).toBe(false);
    expect(swipeFrame(-300, false).offset).toBeGreaterThan(-21);
    expect(swipeFrame(-300, false).share).toBe(0);
  });

  it("switches on a short flick, not on a brush or a slow short drag, nor when the finger turns back", () => {
    expect(swipeSwitches(-24, -0.6, true)).toBe(true);
    expect(swipeSwitches(-6, -0.9, true)).toBe(false);
    expect(swipeSwitches(-24, -0.05, true)).toBe(false);
    expect(swipeSwitches(-60, 0.4, true)).toBe(false);
    expect(swipeSwitches(-60, -0.05, true)).toBe(true);
  });

  it("holds the bar at the span however far the finger goes", () => {
    expect(swipeFrame(-500, true)).toEqual({ offset: -SWIPE_SPAN_PX, share: 1 });
  });
});
