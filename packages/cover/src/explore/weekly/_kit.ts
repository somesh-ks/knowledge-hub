import { n } from "../../svg.js";
import type { Ctx, TemplateOutput } from "../../types.js";

export { circle, polygon, rect, ring } from "../../templates/kit.js";

/**
 * Helpers shared by the weekly explorations. Every style is drawn in 1024 design units and scaled by
 * `ctx.u`, and reads six flat colours: the deep ground G, the faint field F, the mid shade S, the
 * figure A (3:1 on G), the pale matte M (the month's palest colour) and the ink I of the lockup.
 * M and A are pale or light: draw A on G, and draw on M with G.
 */
export interface Flat {
  G: string;
  F: string;
  S: string;
  A: string;
  M: string;
  I: string;
}

export function flat(ctx: Ctx): Flat {
  const { ground, field, shade, accent } = ctx.pal;
  return { G: ground, F: field, S: shade, A: accent, M: ctx.matte ?? ctx.pal.text, I: ctx.ink };
}

/** Wraps design-unit markup into the template output for the whole canvas. */
export function scene(ctx: Ctx, inner: string): TemplateOutput {
  return { body: `<g transform="scale(${n(ctx.u, 4)})">${inner}</g>` };
}

export const SIZE = 1024;

/** Full-canvas fill. */
export const fill = (color: string): string =>
  `<rect width="${SIZE}" height="${SIZE}" fill="${color}"/>`;

export const path = (d: string, color: string, extra = ""): string =>
  `<path d="${d}" fill="${color}"${extra}/>`;

export const stroke = (d: string, color: string, width: number, extra = ""): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}"${extra}/>`;

/** A pie wedge from `a0` to `a1` radians (0 is up, clockwise). */
export function wedge(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number, rr: number): string =>
    `${n(cx + rr * Math.sin(a))} ${n(cy - rr * Math.cos(a))}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${n(cx)} ${n(cy)}L${p(a0, r)}A${n(r)} ${n(r)} 0 ${large} 1 ${p(a1, r)}Z`;
}
