import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clampToGamut, contrastRatio, oklchToHex } from "../../../../packages/cover/src/color";
import { oklchStringToRgb, toHex } from "../../../../scripts/colorMath";
import tokens from "../../../../tokens/tokens.json" with { type: "json" };
import { backingSize, blendTint, MAX_SIDE, paletteUniforms, shouldAnimate } from "./ambientPalette";
import { DARK, LIGHT, lightColors, tint } from "./ambientTint";

type Mode = "light" | "dark";

interface TokenNode {
  $value?: string;
  $extensions?: { dispatch?: { mode?: { dark?: string } } };
  [key: string]: unknown;
}

/** A token's value as a hex color, following aliases and picking the mode's value. */
function colorOf(path: string, mode: Mode): string {
  const node = path
    .split(".")
    .reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], tokens) as TokenNode;
  const raw = (mode === "dark" && node.$extensions?.dispatch?.mode?.dark) || node.$value || "";
  const alias = /^\{(.+)\}$/.exec(raw);
  return alias?.[1] ? colorOf(alias[1], mode) : toHex(oklchStringToRgb(raw));
}

const numberOf = (name: string): number =>
  (tokens.primitive.opacity as unknown as Record<string, { $value: number }>)[name]?.$value ??
  Number.NaN;

const TINT: Record<Mode, number> = {
  light: numberOf("ambient-light"),
  dark: numberOf("ambient-dark"),
};

describe("ambient light contrast", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`keeps every kind of text in the header at 4.5:1 under every palette's light, ${mode} theme`, () => {
      const surface = colorOf("semantic.color.surface", mode);
      // What sits over the light: the title and the meta line. The play chip's accent words would
      // not hold the ratio over it, so the chip carries an opaque container fill of its own; the
      // test below keeps that fill in place.
      const texts = {
        title: colorOf("semantic.color.on-surface", mode),
        meta: colorOf("semantic.color.on-surface-muted", mode),
      };
      // Every offender at once, so a tint that is too strong shows how far off it is and where.
      const tooFaint: string[] = [];
      // The light takes whatever colours a cover image shows, so the proof covers every hue at
      // every chroma up to the theme's cap, from grey to the most vivid the cap allows.
      const { l, maxC: cap } = mode === "light" ? LIGHT : DARK;
      for (let hue = 0; hue < 360; hue += 5) {
        for (const chroma of [0, cap / 4, cap / 2, cap]) {
          const color = tint(oklchToHex(clampToGamut({ l, c: chroma, h: hue })), mode);
          const blended = blendTint(color, surface, TINT[mode]);
          for (const [role, text] of Object.entries(texts)) {
            const ratio = contrastRatio(text, blended);
            if (ratio < 4.5)
              tooFaint.push(`h${hue} c${chroma} ${role} over ${color}: ${ratio.toFixed(2)}`);
          }
        }
      }
      expect(tooFaint).toEqual([]);
    });
  }

  it("gives the play chip an opaque container fill, where its accent words keep their contrast", () => {
    const chip = readFileSync(join(import.meta.dirname, "..", "styles", "buttons.css"), "utf8");
    expect(chip.replace(/\s+/g, " ")).toMatch(/\.chip \{[^}]*background: var\(--chip-bg\);/);
    for (const mode of ["light", "dark"] as const) {
      const container = colorOf("semantic.color.surface-container", mode);
      expect(
        contrastRatio(colorOf("semantic.color.accent", mode), container),
        mode,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("ambient palette", () => {
  // A monthly cover is nine tenths paper: by area alone the light was paper and ink, and the red
  // the eye takes away from the cover was lost. Ink and shadow give no light.
  it("lights the page in the cover's main colour and the two that catch the eye, never its ink", () => {
    const swatches = [
      { hex: "#b7b0a3", share: 0.89 },
      { hex: "#130807", share: 0.05 },
      { hex: "#94443c", share: 0.02 },
      { hex: "#877268", share: 0.01 },
    ];
    expect(lightColors(swatches)).toEqual(["#b7b0a3", "#94443c", "#877268"]);
    expect(lightColors([{ hex: "#274172", share: 1 }])).toEqual(["#274172", "#274172", "#274172"]);
  });

  it("turns colors into three vec3 uniforms", () => {
    const u = paletteUniforms(["#ff0000", "#00ff00", "#0000ff"]);
    expect([...u]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("blends in sRGB the way the browser composites", () => {
    expect(blendTint("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(blendTint("#ff0000", "#ffffff", 0)).toBe("#ffffff");
  });

  it("sizes the backing store to 128 on the long side at most", () => {
    expect(backingSize(1000, 500)).toEqual([MAX_SIDE, 64]);
    expect(backingSize(300, 600)).toEqual([64, MAX_SIDE]);
    expect(MAX_SIDE).toBeLessThanOrEqual(256);
    expect(backingSize(0, 0)).toEqual([1, 1]);
  });
});

describe("frame gate", () => {
  it("draws only when visible, on screen and motion is allowed", () => {
    expect(shouldAnimate({ visible: true, onScreen: true, motionAllowed: true })).toBe(true);
    expect(shouldAnimate({ visible: false, onScreen: true, motionAllowed: true })).toBe(false);
    expect(shouldAnimate({ visible: true, onScreen: false, motionAllowed: true })).toBe(false);
    expect(shouldAnimate({ visible: true, onScreen: true, motionAllowed: false })).toBe(false);
  });
});
