import { clampToGamut, contrastRatio, hexToOklch, mixHex, oklchToHex } from "../color.js";
import { type CoverMode, holdContrast, toneFor } from "../mode.js";
import { MAX_CHROMA } from "../palettes.js";
import type { Scheme } from "../season.js";
import type { Ctx, Palette } from "../types.js";

/**
 * Every monthly cover prints on the month's paper in the same inks, so a grid of them reads as one
 * set. The three series sit on three close tints of that paper (see SERIES_L). Five flat colours, all
 * from the month's scheme:
 * paper P, ink K (darkest), spot D (the most chromatic colour at 3:1 on paper), tint T (the most
 * chromatic pale colour, kept soft) and haze H (paper half way to the tint).
 */
export interface Paper {
  P: string;
  K: string;
  D: string;
  T: string;
  H: string;
}

const L = (hex: string): number => hexToOklch(hex).l;
const C = (hex: string): number => hexToOklch(hex).c;
const most = (xs: string[]): string => {
  const best = [...xs].sort((a, b) => C(b) - C(a))[0];
  if (!best) throw new Error("Scheme has no colour for this role");
  return best;
};

/**
 * The paper's lightness for each series and theme: one family of soft, bright stocks, a step darker
 * on a dark page. Weeklies take the palest, on-demand covers a step deeper and dailies a step deeper
 * again, close enough to read as one set and far enough to tell apart in a grid.
 */
export const SERIES_L = {
  weekly: { light: 0.92, dark: 0.85 },
  "on-demand": { light: 0.86, dark: 0.79 },
  daily: { light: 0.8, dark: 0.73 },
} as const satisfies Record<string, Record<CoverMode, number>>;
export type PaperSeries = keyof typeof SERIES_L;

/** How far the tint sits below the paper, so tint shapes read as printed, not as highlights. */
const TINT_STEP = 0.09;

/**
 * The paper's least chroma: enough to read as a tinted stock in the month's hue, not as grey. At 0.03
 * the paper, nine tenths of every cover, made the grid look dull (2026-10-16).
 */
const PAPER_CHROMA = 0.045;
/** The spot and the tint print this much richer than the scheme's colour, up to MAX_CHROMA. */
const INK_LIFT = 1.25;

const richer = (hex: string): string => {
  const o = hexToOklch(hex);
  return oklchToHex(clampToGamut({ ...o, c: Math.min(MAX_CHROMA, o.c * INK_LIFT) }));
};

const atL = (hex: string, l: number, minC = 0): string => {
  const o = hexToOklch(hex);
  return oklchToHex({ ...o, l, c: Math.max(o.c, minC) });
};

export function paper(scheme: Scheme, mode: CoverMode, series: PaperSeries = "weekly"): Paper {
  const colors = [...scheme.colors].sort((a, b) => L(a) - L(b));
  const pale = colors[colors.length - 1] as string;
  const l = SERIES_L[series][mode];
  const P = atL(pale, l, PAPER_CHROMA);
  const T = richer(atL(most(colors.filter((c) => L(c) >= 0.82 && L(c) <= 0.93)), l - TINT_STEP));
  const D = most(colors.slice(1).filter((c) => contrastRatio(pale, c) >= 3));
  return {
    P,
    K: holdContrast(toneFor(colors[0] as string, mode), P, 7),
    D: holdContrast(richer(toneFor(D, mode)), P, 3),
    T,
    H: mixHex(P, T, 0.45),
  };
}

/** The on-demand stock: the month's paper at the on-demand tint, the ground around the ink disc. */
export function stock(scheme: Scheme, mode: CoverMode): string {
  return paper(scheme, mode, "on-demand").P;
}

/**
 * An on-demand cover on the stock: the disc in ink, the art on it in paper, the spot as its shade.
 * Returns the palette (ground is the disc) and the matte.
 */
export function stockPalette(
  base: Palette,
  p: Paper,
  matte: string,
): { palette: Palette; type: string } {
  const type = holdContrast(p.K, matte, 4.5);
  return {
    palette: {
      ...base,
      ground: p.K,
      accent: p.P,
      text: type,
      shade: p.D,
      field: mixHex(p.K, p.P, 0.16),
    },
    type,
  };
}

/** The paper as a cover palette: ground P, figure and type K, shade D, field T. */
export function paperPalette(base: Palette, p: Paper): Palette {
  return { ...base, ground: p.P, accent: p.K, text: p.K, shade: p.D, field: p.T };
}

/** The paper colours back out of a weekly's context. */
export function paperOf(ctx: Ctx): Paper {
  const { ground, accent, shade, field } = ctx.pal;
  return { P: ground, K: accent, D: shade, T: field, H: mixHex(ground, field, 0.45) };
}
