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

  it("leaves it alone for a move smaller than a step", () => {
    expect(foldedAfter(300, 300 + FOLD_STEP_PX - 1)).toBeNull();
  });
});
