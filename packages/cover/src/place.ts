import { clamp } from "./math.js";
import type { Ctx, Point, Rect } from "./types.js";

export function insideRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** True if a circle at `c` with radius `radius` comes within `gap` of any type zone. */
export function circleHitsQuiet(ctx: Ctx, c: Point, radius: number, gap = 0): boolean {
  return ctx.quiet.some((r) => {
    const nx = clamp(c.x, r.x, r.x + r.w);
    const ny = clamp(c.y, r.y, r.y + r.h);
    return Math.hypot(c.x - nx, c.y - ny) < radius + gap;
  });
}

/** Center of the first quiet zone, which is always the date lockup. */
export function lockupCenter(ctx: Ctx): Point {
  const r = ctx.quiet[0] ?? { x: 0, y: 0, w: ctx.w, h: ctx.h };
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
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
