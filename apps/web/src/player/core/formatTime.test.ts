import { describe, expect, it } from "vitest";
import { remainingSign } from "./formatTime";

describe("remainingSign", () => {
  it("marks time still to go with a minus", () => {
    expect(remainingSign(130)).toBe("-");
    expect(remainingSign(1)).toBe("-");
  });

  it("drops the minus once the clock reads 0:00, so the end never says -0:00", () => {
    expect(remainingSign(0)).toBe("");
    expect(remainingSign(0.4)).toBe("");
    expect(remainingSign(Number.NaN)).toBe("");
  });
});
