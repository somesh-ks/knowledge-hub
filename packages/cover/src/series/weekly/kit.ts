import { n } from "../../svg.js";
import type { Ctx, TemplateOutput } from "../../types.js";

export { circle, polygon, rect } from "../../templates/kit.js";
export { type Paper, paperOf } from "../paper.js";

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
