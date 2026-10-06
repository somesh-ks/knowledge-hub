import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./color.js";
import {
  allPalettes,
  DARK_PALETTE_IDS,
  getPalette,
  PALETTE_IDS,
  paletteAccent,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from "./palettes.js";

const HEX = /^#[0-9a-f]{6}$/;

describe("palettes", () => {
  it("ships twelve palettes with unique ids", () => {
    expect(PALETTE_IDS).toHaveLength(12);
    expect(new Set(PALETTE_IDS).size).toBe(12);
  });

  it("resolves every role to a hex color", () => {
    for (const p of allPalettes()) {
      for (const role of ["ground", "field", "shade", "accent", "text"] as const) {
        expect(p[role], `${p.id}.${role}`).toMatch(HEX);
      }
    }
  });

  it("holds the date text at 4.5:1 or better on ground and on the field tint", () => {
    for (const p of allPalettes()) {
      expect(contrastRatio(p.text, p.ground), `${p.id} on ground`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.text, p.field), `${p.id} on field`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the accent distinguishable from the ground", () => {
    for (const p of allPalettes()) {
      expect(contrastRatio(p.accent, p.ground), p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("labels tone honestly: light grounds are light, dark grounds are dark", () => {
    for (const p of allPalettes()) {
      const luminance = relativeLuminance(p.ground);
      if (p.tone === "light") expect(luminance, p.id).toBeGreaterThan(0.6);
      else expect(luminance, p.id).toBeLessThan(0.05);
    }
  });

  it("offers enough dark palettes for weekly digests to avoid repeats", () => {
    expect(DARK_PALETTE_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of DARK_PALETTE_IDS) expect(getPalette(id).tone).toBe("dark");
  });

  it("rejects unknown palettes", () => {
    expect(() => getPalette("nope")).toThrow(/Unknown cover palette/);
    expect(() => paletteAccent("nope")).toThrow();
  });
});

describe("paletteAccent", () => {
  it("returns an accent that reads on the reader's light and dark surfaces", () => {
    for (const id of PALETTE_IDS) {
      const { light, dark, bg } = paletteAccent(id);
      expect(light, id).toMatch(HEX);
      expect(dark, id).toMatch(HEX);
      expect(contrastRatio(light, SURFACE_LIGHT), `${id} light`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(dark, SURFACE_DARK), `${id} dark`).toBeGreaterThanOrEqual(3);
      expect(bg).toBe(getPalette(id).ground);
    }
  });
});
