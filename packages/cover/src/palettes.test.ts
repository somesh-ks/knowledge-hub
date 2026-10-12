import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color.js";
import {
  allPalettes,
  DARK_PALETTE_IDS,
  getPalette,
  invertPalette,
  LOCKUP_CONTRAST,
  PALETTE_IDS,
  paletteAccent,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from "./palettes.js";

const HEX = /^#[0-9a-f]{6}$/;
/** Non-text contrast for a figure against its ground (WCAG 1.4.11). */
const UI_CONTRAST = 3;

/** Ids that old digests name in their frontmatter. They must keep resolving whatever they draw. */
const LEGACY_IDS = [
  "fog-lingonberry",
  "sea-lingonberry",
  "ultramarine",
  "indigo-aqua",
  "lichen",
  "kelp",
  "marigold-fog",
  "saffron-ink",
  "plum-pearl",
  "oxblood",
  "glacier",
  "graphite-signal",
];

describe("palettes", () => {
  it("keeps every id an old digest can name, and adds more", () => {
    for (const id of LEGACY_IDS) expect(PALETTE_IDS, id).toContain(id);
    expect(PALETTE_IDS.length).toBeGreaterThan(LEGACY_IDS.length);
    expect(new Set(PALETTE_IDS).size).toBe(PALETTE_IDS.length);
  });

  it("resolves every role to a hex color", () => {
    for (const p of allPalettes()) {
      for (const role of ["ground", "field", "shade", "accent", "text"] as const) {
        expect(p[role], `${p.id}.${role}`).toMatch(HEX);
      }
    }
  });

  it("holds the figure at 3:1 or better against the ground", () => {
    for (const p of allPalettes()) {
      expect(contrastRatio(p.accent, p.ground), p.id).toBeGreaterThanOrEqual(UI_CONTRAST);
    }
  });

  it("holds the lockup text at 4.5:1 or better against the ground it sits on", () => {
    for (const p of allPalettes()) {
      expect(contrastRatio(p.text, p.ground), p.id).toBeGreaterThanOrEqual(LOCKUP_CONTRAST);
    }
  });

  it("keeps both contrasts when an episode inverts the palette", () => {
    for (const p of allPalettes()) {
      const inverted = invertPalette(p);
      expect(inverted.ground, p.id).toBe(p.accent);
      expect(inverted.accent, p.id).toBe(p.ground);
      expect(
        contrastRatio(inverted.accent, inverted.ground),
        `${p.id} figure`,
      ).toBeGreaterThanOrEqual(UI_CONTRAST);
      expect(contrastRatio(inverted.text, inverted.ground), `${p.id} text`).toBeGreaterThanOrEqual(
        LOCKUP_CONTRAST,
      );
    }
  });

  it("offers enough dark palettes for weekly digests to avoid repeats", () => {
    expect(DARK_PALETTE_IDS.length).toBeGreaterThanOrEqual(6);
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
