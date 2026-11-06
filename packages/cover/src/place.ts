import { clamp } from "./math.js";
import type { Ctx, Point, Rect } from "./types.js";

/** True if a circle at `c` with radius `radius` comes within `gap` of any type zone. */
export function circleHitsQuiet(ctx: Ctx, c: Point, radius: number, gap = 0): boolean {
  return ctx.quiet.some((r) => {
    const nx = clamp(c.x, r.x, r.x + r.w);
    const ny = clamp(c.y, r.y, r.y + r.h);
    return Math.hypot(c.x - nx, c.y - ny) < radius + gap;
  });
}

/** Distance from p to the nearest type zone: 0 inside one. */
function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Distance from a point to the nearest type zone; how big a circle there can grow before it touches type. */
export function clearRadius(ctx: Ctx, p: Point): number {
  return ctx.quiet.reduce(
    (least, r) => Math.min(least, distanceToRect(p, r)),
    Number.POSITIVE_INFINITY,
  );
}
