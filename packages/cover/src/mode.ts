import tokens from "../../../tokens/covers.json" with { type: "json" };
import { contrastRatio, hexToOklch, mixHex, type Oklch, oklchToHex } from "./color.js";
import { FIELD_MIX, LOCKUP_CONTRAST, SHADE_MIX } from "./palettes.js";

/** A figure against its ground (WCAG 1.4.11), as the palettes and schemes hold it. */
const FORM_CONTRAST = 3;

import type { Palette } from "./types.js";

/** The app theme a cover is drawn for. Left out, a cover keeps the colours as authored. */
export type CoverMode = "light" | "dark";
export const COVER_MODES: readonly CoverMode[] = ["light", "dark"];

interface ModeRule {
  /** The lightness band [low, high] every colour is mapped into. */
  lightness: readonly [number, number];
  /** Chroma multiplier. */
  chroma: number;
}

function readMode(mode: CoverMode): ModeRule {
  const raw = tokens.mode[mode] as {
    lightness?: { $value?: unknown };
    chroma?: { $value?: unknown };
  };
  const band = raw.lightness?.$value;
  const chroma = raw.chroma?.$value;
  if (
    !Array.isArray(band) ||
    band.length !== 2 ||
    !band.every((v) => typeof v === "number" && v >= 0 && v <= 1) ||
    typeof chroma !== "number"
  ) {
    throw new Error(`tokens/covers.json: mode "${mode}" needs lightness [low, high] and chroma`);
  }
  return { lightness: [band[0], band[1]], chroma };
}

const RULES: Record<CoverMode, ModeRule> = { light: readMode("light"), dark: readMode("dark") };

/** One colour as the mode draws it: lightness mapped into the band, chroma scaled. */
export function toneFor(hex: string, mode: CoverMode): string {
  const { lightness, chroma } = RULES[mode];
  const [low, high] = lightness;
  const c: Oklch = hexToOklch(hex);
  return oklchToHex({ l: low + c.l * (high - low), c: c.c * chroma, h: c.h });
}

/**
 * Moves `fg` in lightness away from `bg` until the pair reads at `floor`, so a mode that narrows the
 * lightness range never costs a contrast rule. When no lightness on that side reads (a mid-tone ground
 * under dark type), the type crosses to the other side. Returns `fg` unchanged when it already reads.
 */
export function holdContrast(fg: string, bg: string, floor: number): string {
  if (contrastRatio(fg, bg) >= floor) return fg;
  const f = hexToOklch(fg);
  const away = f.l >= hexToOklch(bg).l ? 1 : -1;
  for (const direction of [away, -away]) {
    for (let step = 1; step <= 100; step += 1) {
      const l = Math.min(1, Math.max(0, f.l + direction * step * 0.01));
      const candidate = oklchToHex({ ...f, l });
      if (contrastRatio(candidate, bg) >= floor) return candidate;
      if (l === 0 || l === 1) break;
    }
  }
  const paper = "#ffffff";
  return contrastRatio(paper, bg) >= contrastRatio("#000000", bg) ? paper : "#000000";
}

/** A palette with every role toned for the mode; field and shade are derived again from the result. */
export function tonePalette(palette: Palette, mode: CoverMode): Palette {
  const ground = toneFor(palette.ground, mode);
  const accent = holdContrast(toneFor(palette.accent, mode), ground, FORM_CONTRAST);
  return {
    ...palette,
    ground,
    accent,
    text: holdContrast(toneFor(palette.text, mode), ground, LOCKUP_CONTRAST),
    field: mixHex(ground, accent, FIELD_MIX),
    shade: mixHex(ground, accent, SHADE_MIX),
  };
}
