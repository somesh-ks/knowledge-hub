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
  (tokens.primitive.opacity as Record<string, { $value: number }>)[name]?.$value ?? Number.NaN;

const TINT: Record<Mode, number> = {
  light: numberOf("ambient-light"),
  dark: numberOf("ambient-dark"),
};

describe("ambient light contrast", () => {
  it("keeps the peak tints modest", () => {
    expect(TINT.light).toBeLessThanOrEqual(0.12);
    expect(TINT.dark).toBeLessThanOrEqual(0.18);
  });

  for (const mode of ["light", "dark"] as const) {
    it(`keeps the title and the meta line at 4.5:1 under every palette's light, ${mode} theme`, () => {
      const surface = colorOf("semantic.color.surface", mode);
      const texts = {
        title: colorOf("semantic.color.on-surface", mode),
        meta: colorOf("semantic.color.on-surface-muted", mode),
      };
      let worst = { ratio: Number.POSITIVE_INFINITY, where: "" };
      for (const palette of allPalettes()) {
        for (const color of [palette.ground, palette.accent, palette.shade, palette.field]) {
          const blended = blendTint(color, surface, TINT[mode]);
          for (const [role, text] of Object.entries(texts)) {
            const ratio = contrastRatio(text, blended);
            if (ratio < worst.ratio) worst = { ratio, where: `${palette.id} ${role} ${color}` };
            expect(ratio, `${palette.id} ${role} over ${color}, ${mode}`).toBeGreaterThanOrEqual(
              4.5,
            );
          }
        }
      }
      console.info(`worst ${mode}: ${worst.ratio.toFixed(2)} (${worst.where})`);
    });
  }
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
