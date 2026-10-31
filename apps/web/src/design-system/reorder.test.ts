import { describe, expect, it } from "vitest";
import { slotAt } from "./reorder";

describe("where a dragged row lands", () => {
  // Four rows of 60px, middles at 30, 90, 150 and 210.
  const mids = [30, 90, 150, 210];

  it("counts the other rows whose middle is above the pointer", () => {
    expect(slotAt(10, mids, 2)).toBe(0);
    expect(slotAt(100, mids, 2)).toBe(2);
    expect(slotAt(400, mids, 0)).toBe(3);
  });

  it("never counts the row being dragged, so it stays put under its own middle", () => {
    expect(slotAt(150, mids, 2)).toBe(2);
    expect(slotAt(30, mids, 0)).toBe(0);
  });
});
