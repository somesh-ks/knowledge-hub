import { describe, expect, it } from "vitest";
import { FOLD_STEP_PX, FOLD_TOP_PX, foldedAfter } from "./fabScroll";

describe("foldedAfter", () => {
  it("extends the button near the top of a page, whatever the direction", () => {
    expect(foldedAfter(200, FOLD_TOP_PX)).toBe(false);
    expect(foldedAfter(0, FOLD_TOP_PX - 1)).toBe(false);
  });

  it("folds it while scrolling down and extends it while scrolling up", () => {
    expect(foldedAfter(100, 100 + FOLD_STEP_PX)).toBe(true);
    expect(foldedAfter(400, 400 - FOLD_STEP_PX)).toBe(false);
  });

  it("ignores an upward step at the end of the page, where the URL bar resizing clamps scrollY", () => {
    expect(foldedAfter(900, 900 - FOLD_STEP_PX - 20, true)).toBeNull();
    expect(foldedAfter(900, 900 + FOLD_STEP_PX, true)).toBe(true);
  });

  it("leaves it alone for a move smaller than a step", () => {
    expect(foldedAfter(300, 300 + FOLD_STEP_PX - 1)).toBeNull();
  });
});
