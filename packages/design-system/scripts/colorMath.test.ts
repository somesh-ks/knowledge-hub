import { describe, expect, it } from "vitest";
import { parseOklch } from "./colorMath.js";

describe("colorMath", () => {
  it("refuses an oklch() whose digits are not numbers, rather than building a #NaNNaNNaN color", () => {
    expect(() => parseOklch("oklch(50% ... 10)")).toThrow(/Invalid oklch/);
    expect(() => parseOklch("oklch(50% 0.1 1.2.3)")).toThrow(/Invalid oklch/);
    expect(() => parseOklch("oklch(0.5 0.1 30 / 1.2.3)")).toThrow(/Invalid oklch/);
  });
});
