import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../../../packages/cover/src/color";
import { allPalettes } from "../../../../packages/cover/src/palettes";
import { oklchStringToRgb, toHex } from "../../../../scripts/colorMath";
import tokens from "../../../../tokens/tokens.json" with { type: "json" };
import {
  ambientColors,
  backingSize,
  blendTint,
  DRIFT_SECONDS,
  FRAME_MS,
  MAX_SIDE,
  paletteUniforms,
  shouldAnimate,
} from "./ambientPalette";
import { tintColors } from "./ambientTint";

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
  it("keeps the peak tints modest", () => {
    expect(TINT.light).toBeLessThanOrEqual(0.7);
    expect(TINT.dark).toBeLessThanOrEqual(0.4);
  });

  for (const mode of ["light", "dark"] as const) {
    it(`keeps every kind of text in the header at 4.5:1 under every palette's light, ${mode} theme`, () => {
      const surface = colorOf("semantic.color.surface", mode);
      // What sits over the light: the title and the meta line. The play chip's accent words would
      // not hold the ratio on the light theme (4.24 to 4.33 across the palettes), so ambient.css
      // gives the chip the page's own surface; the test below keeps that rule in place.
      const texts = {
        title: colorOf("semantic.color.on-surface", mode),
        meta: colorOf("semantic.color.on-surface-muted", mode),
      };
      // Every offender at once, so a tint that is too strong shows how far off it is and where.
      const tooFaint: string[] = [];
      for (const palette of allPalettes()) {
        for (const color of tintColors(palette.ground, palette.accent, palette.shade, mode)) {
          const blended = blendTint(color, surface, TINT[mode]);
          for (const [role, text] of Object.entries(texts)) {
            const ratio = contrastRatio(text, blended);
            if (ratio < 4.5)
              tooFaint.push(`${palette.id} ${role} over ${color}: ${ratio.toFixed(2)}`);
          }
        }
      }
      expect(tooFaint).toEqual([]);
    });
  }

  it("stands the play chip on the page's surface, where its accent words keep their contrast", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "styles", "ambient.css"), "utf8");
    expect(css.replace(/\s+/g, " ")).toContain(
      ":where(.hero) .chip { background-color: var(--color-surface); }",
    );
  });
});

describe("ambient layer shape", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "styles", "ambient.css"), "utf8");

  it("stays inside the header's box from top to bottom", () => {
    // Reaching above the header put the light under the phone's app bar, which cut it in a line.
    expect(css).toMatch(/\.ambient \{[^}]*\n {2}inset-block: 0;/);
  });

  it("fades to nothing at the top and before the bottom, in both spellings of the mask", () => {
    const ellipses = [
      ...css.matchAll(/ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%,\s+black,/g),
    ];
    expect(ellipses).toHaveLength(2);
    for (const [, , radiusY, , centreY] of ellipses) {
      expect(Number(radiusY)).toBeLessThanOrEqual(Number(centreY));
      expect(Number(centreY) + Number(radiusY)).toBeLessThanOrEqual(100);
    }
  });

  it("clips its outermost row, which a GPU leaves unmasked", () => {
    expect(css).toMatch(/\.ambient \{[^}]*\n {2}clip-path: inset\(1px\);/);
  });
});

describe("ambient palette", () => {
  it("puts the most colorful color first", () => {
    expect(ambientColors("#808080", "#ff0000", "#aa4040")[0]).toBe("#ff0000");
    expect(ambientColors("#00aa00", "#777777", "#336633")[0]).toBe("#00aa00");
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

  it("drifts slowly and draws at most 30 frames a second", () => {
    expect(DRIFT_SECONDS).toBeGreaterThanOrEqual(40);
    expect(1000 / FRAME_MS).toBeLessThanOrEqual(30);
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
