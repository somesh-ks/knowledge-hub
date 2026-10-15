import { contrastRatio, hexToOklch, mixHex } from "../../color.js";
import { schemeFor } from "../../season.js";
import { n } from "../../svg.js";

export { circle, polygon, rect } from "../../templates/kit.js";

/**
 * Paper weeklies: the week's cover is printed on the month's palest colour, so it reads light next to
 * the dark daily and the mid-tone on-demand plate. Five flat colours, all from the month's scheme:
 * paper P, ink K (darkest), spot D (the most chromatic colour at 3:1 on paper), tint T (the most
 * chromatic light colour) and haze H (paper half way to the tint).
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

export function paper(date: string): Paper {
  const [year, month] = date.split("-").map(Number) as [number, number];
  const colors = [...schemeFor(year, month).colors].sort((a, b) => L(a) - L(b));
  const P = colors[colors.length - 1] as string;
  const K = colors[0] as string;
  const D = most(colors.slice(1).filter((c) => contrastRatio(P, c) >= 3));
  const T = most(colors.filter((c) => L(c) >= 0.7 && c !== P));
  return { P, K, D, T, H: mixHex(P, T, 0.45) };
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
export function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(cx, cy, r1, a0)}A${n(r1)} ${n(r1)} 0 ${large} 1 ${pt(cx, cy, r1, a1)}L${pt(cx, cy, r0, a1)}A${n(r0)} ${n(r0)} 0 ${large} 0 ${pt(cx, cy, r0, a0)}Z`;
}

/** An ellipse petal of length `len` and width `w` from the centre, turned `a` radians. */
export function petal(cx: number, cy: number, len: number, w: number, a: number, color: string): string {
  const deg = (a * 180) / Math.PI;
  return `<ellipse cx="${n(cx)}" cy="${n(cy - len / 2)}" rx="${n(w / 2)}" ry="${n(len / 2)}" fill="${color}" transform="rotate(${n(deg)} ${n(cx)} ${n(cy)})"/>`;
}
