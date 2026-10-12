import { describe, expect, it } from "vitest";
import { rovingStep, rovingStop } from "./rovingFocus";

describe("rovingStep", () => {
  it("moves one item with the arrows and stops at the ends", () => {
    expect(rovingStep("ArrowDown", 3, 29)).toBe(4);
    expect(rovingStep("ArrowUp", 3, 29)).toBe(2);
    expect(rovingStep("ArrowDown", 28, 29)).toBe(28);
    expect(rovingStep("ArrowUp", 0, 29)).toBe(0);
  });

  it("jumps to the ends with Home and End", () => {
    expect(rovingStep("Home", 12, 29)).toBe(0);
    expect(rovingStep("End", 12, 29)).toBe(28);
  });

  it("leaves every other key alone, Tab and Enter included", () => {
    expect(rovingStep("Tab", 3, 29)).toBeNull();
    expect(rovingStep("Enter", 3, 29)).toBeNull();
    expect(rovingStep("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("rovingStop", () => {
  it("is the focused item while focus is inside the list", () => {
    expect(rovingStop(29, 7, 3, 5)).toBe(7);
  });

  it("is the current item once focus has left, else the one focused last, else the first", () => {
    expect(rovingStop(29, -1, 3, 5)).toBe(3);
    expect(rovingStop(29, -1, -1, 5)).toBe(5);
    expect(rovingStop(29, -1, -1, -1)).toBe(0);
    expect(rovingStop(4, -1, -1, 9)).toBe(0);
    expect(rovingStop(0, -1, -1, -1)).toBe(-1);
  });
});
