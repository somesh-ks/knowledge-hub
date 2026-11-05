import { describe, expect, it } from "vitest";
import { clampToGamut, oklchToHex } from "../packages/cover/src/color.js";
import { oklchToRgb, parseOklch, toHex } from "./colorMath.js";

describe("colorMath", () => {
  it("refuses an oklch() whose digits are not numbers, rather than building a #NaNNaNNaN color", () => {
    expect(() => parseOklch("oklch(50% ... 10)")).toThrow(/Invalid oklch/);
    expect(() => parseOklch("oklch(50% 0.1 1.2.3)")).toThrow(/Invalid oklch/);
    expect(() => parseOklch("oklch(0.5 0.1 30 / 1.2.3)")).toThrow(/Invalid oklch/);
  });

  it("gives the same hex as the covers' copy of the math for any color inside sRGB", () => {
    // Two copies of one formula: an edit to a matrix, the gamma or the rounding in one of them
    // would move the theme-color meta tags and the covers apart with no test noticing. Outside
    // sRGB they differ by design (clip against chroma reduction), so only colors both treat as
    // inside are compared.
    const apart: string[] = [];
    let compared = 0;
    for (let l = 0.1; l < 1; l += 0.1) {
      for (let c = 0; c <= 0.4; c += 0.04) {
        for (let h = 0; h < 360; h += 15) {
          const color = { l, c, h };
          if (clampToGamut(color).c !== c) continue;
          compared += 1;
          const here = toHex(oklchToRgb({ ...color, alpha: 1 }));
          const there = oklchToHex(color);
          if (here !== there) {
            apart.push(`oklch(${l.toFixed(1)} ${c.toFixed(2)} ${h}): ${here} against ${there}`);
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
    expect(apart).toEqual([]);
  });
});
