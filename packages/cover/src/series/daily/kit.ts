import { n } from "../../svg.js";
import type { Ctx, TemplateOutput } from "../../types.js";

export { circle, polygon, rect } from "../../templates/kit.js";

/**
 * Where a daily may draw, in design units (1024 canvas). The date sits bottom left and the wordmark
 * top left, so the right-hand column and the strip between the two are free. `left` is the first x
 * that clears the date box; `dateTop` the first y that does, `markBottom` the last y of the wordmark.
 */
export interface Zone {
  left: number;
  dateTop: number;
  markBottom: number;
}

export function zone(ctx: Ctx): Zone {
  const [date, mark] = ctx.quiet;
  const u = ctx.u;
  if (!date || !mark) return { left: 400, dateTop: 620, markBottom: 160 };
  return {
    left: Math.max(400, (date.x + date.w) / u + 34),
    dateTop: date.y / u - 34,
    markBottom: (mark.y + mark.h) / u + 34,
  };
}

/** Wraps art written in design units so it fills the real canvas. */
export function frame(ctx: Ctx, body: string): TemplateOutput {
  return { body: `<g transform="scale(${n(ctx.u, 4)})">${body}</g>` };
}

export function path(d: string, fill: string): string {
  return `<path d="${d}" fill="${fill}"/>`;
}

export function tri(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  fill: string,
): string {
  return `<polygon points="${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])} ${n(c[0])},${n(c[1])}" fill="${fill}"/>`;
}
