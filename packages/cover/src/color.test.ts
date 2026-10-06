import { describe, expect, it } from "vitest";
import {
  clampToGamut,
  contrastRatio,
  hexToOklch,
  hexToRgb,
  mixHex,
  multiplyHex,
  oklchToHex,
  parseOklch,
  screenHex,
} from "./color.js";

describe("parseOklch", () => {
  it("reads percent and decimal lightness", () => {
    expect(parseOklch("oklch(70% 0.165 14)")).toEqual({ l: 0.7, c: 0.165, h: 14 });
    expect(parseOklch("oklch(0.5 0.1 200)")).toEqual({ l: 0.5, c: 0.1, h: 200 });
  });

  it("rejects anything that is not oklch()", () => {
    expect(() => parseOklch("#ffffff")).toThrow();
    expect(() => parseOklch("oklch(70% banana 14)")).toThrow();
  });
});

describe("oklchToHex", () => {
  // Reference values from the CSS Color 4 sample conversions.
  it.each([
    ["oklch(100% 0 0)", "#ffffff"],
    ["oklch(0% 0 0)", "#000000"],
    ["oklch(62.8% 0.2577 29.23)", "#ff0000"],
    ["oklch(86.64% 0.294827 142.4953)", "#00ff00"],
    ["oklch(45.2% 0.313214 264.052)", "#0000ff"],
    ["oklch(59.99% 0 0)", "#808080"],
  ])("converts %s to %s", (input, expected) => {
    const got = hexToRgb(oklchToHex(parseOklch(input)));
    const want = hexToRgb(expected);
    // One 8-bit step of slack: the published OKLCH values are rounded.
    for (const [i, channel] of got.entries()) {
      expect(Math.abs(channel - (want[i] as number))).toBeLessThanOrEqual(1);
    }
  });

  it("clamps out-of-gamut colors by reducing chroma, not by clipping channels", () => {
    const wild = { l: 0.7, c: 0.4, h: 150 };
    const clamped = clampToGamut(wild);
    expect(clamped.c).toBeLessThan(wild.c);
    expect(clamped.l).toBeCloseTo(wild.l, 6);
    expect(clamped.h).toBeCloseTo(wild.h, 6);
    expect(oklchToHex(wild)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("round-trips through hex within rounding error", () => {
    for (const hex of ["#b41a42", "#0b151e", "#e8eff3", "#6ed9d2"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("matches a known pair", () => {
    // #767676 on white is the classic AA threshold, 4.54:1.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#b41a42", "#e8eff3")).toBeCloseTo(
      contrastRatio("#e8eff3", "#b41a42"),
      10,
    );
  });
});

describe("blends", () => {
  it("mixes in OKLab, so the midpoint of black and white is the perceptual middle", () => {
    const mid = hexToOklch(mixHex("#000000", "#ffffff", 0.5));
    expect(mid.l).toBeCloseTo(0.5, 1);
  });

  it("multiplies darker and screens lighter", () => {
    expect(multiplyHex("#808080", "#808080")).toBe("#404040");
    expect(screenHex("#808080", "#808080")).toBe("#c0c0c0");
  });
});
