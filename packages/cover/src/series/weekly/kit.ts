import { contrastRatio, hexToOklch, mixHex, oklchToHex } from "../../color.js";
import { type CoverMode, holdContrast, toneFor } from "../../mode.js";
import type { Scheme } from "../../season.js";
import { n } from "../../svg.js";
import type { Ctx, Palette, TemplateOutput } from "../../types.js";

export { circle, polygon, rect } from "../../templates/kit.js";

/**
 * Paper weeklies: the week's cover is printed on a dimmed stock of the month's palest colour, so it
 * reads light next to the dark daily and the mid-tone on-demand cover. Five flat colours, all from the
 * month's scheme:
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

/** Paper lightness per theme: a soft, dimmed stock rather than white, a step darker on a dark page. */
export const PAPER_L: Record<CoverMode, number> = { light: 0.88, dark: 0.8 };
/** How far the tint sits below the paper, so tint shapes read as printed, not as highlights. */
const TINT_STEP = 0.09;

const atL = (hex: string, l: number, minC = 0): string => {
  const o = hexToOklch(hex);
  return oklchToHex({ ...o, l, c: Math.max(o.c, minC) });
};

export function paper(scheme: Scheme, mode: CoverMode): Paper {
  const colors = [...scheme.colors].sort((a, b) => L(a) - L(b));
  const pale = colors[colors.length - 1] as string;
  const P = atL(pale, PAPER_L[mode], 0.02);
  const T = atL(
    most(colors.filter((c) => L(c) >= 0.82 && L(c) <= 0.93)),
    PAPER_L[mode] - TINT_STEP,
  );
  const D = most(colors.slice(1).filter((c) => contrastRatio(pale, c) >= 3));
  return {
    P,
    K: holdContrast(toneFor(colors[0] as string, mode), P, 7),
    D: holdContrast(toneFor(D, mode), P, 3),
    T,
    H: mixHex(P, T, 0.45),
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

/** Wraps art written in design units so it fills the real canvas. */
export function scene(ctx: Ctx, body: string): TemplateOutput {
  return { body: `<g transform="scale(${n(ctx.u, 4)})">${body}</g>` };
}

export const SIZE = 1024;
export const fill = (color: string): string =>
  `<rect width="${SIZE}" height="${SIZE}" fill="${color}"/>`;
export const path = (d: string, color: string): string => `<path d="${d}" fill="${color}"/>`;
export const stroke = (d: string, color: string, width: number): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;

const pt = (cx: number, cy: number, r: number, a: number): string =>
  `${n(cx + r * Math.sin(a))} ${n(cy - r * Math.cos(a))}`;

/** A ring sector from `a0` to `a1` radians (0 is up, clockwise). */
export function sector(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(cx, cy, r1, a0)}A${n(r1)} ${n(r1)} 0 ${large} 1 ${pt(cx, cy, r1, a1)}L${pt(cx, cy, r0, a1)}A${n(r0)} ${n(r0)} 0 ${large} 0 ${pt(cx, cy, r0, a0)}Z`;
}

/** An ellipse petal of length `len` and width `w` from the centre, turned `a` radians. */
export function petal(
  cx: number,
  cy: number,
  len: number,
  w: number,
  a: number,
  color: string,
): string {
  const deg = (a * 180) / Math.PI;
  return `<ellipse cx="${n(cx)}" cy="${n(cy - len / 2)}" rx="${n(w / 2)}" ry="${n(len / 2)}" fill="${color}" transform="rotate(${n(deg)} ${n(cx)} ${n(cy)})"/>`;
}
