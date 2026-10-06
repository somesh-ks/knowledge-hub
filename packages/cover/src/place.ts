import { clamp } from "./math.js";
import type { Ctx, Point, Rect } from "./types.js";

export function insideRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function inQuiet(ctx: Ctx, p: Point): boolean {
  return ctx.quiet.some((r) => insideRect(p, r));
}

/** True if a circle at `c` with radius `radius` comes within `gap` of any type zone. */
export function circleHitsQuiet(ctx: Ctx, c: Point, radius: number, gap = 0): boolean {
  return ctx.quiet.some((r) => {
    const nx = clamp(c.x, r.x, r.x + r.w);
    const ny = clamp(c.y, r.y, r.y + r.h);
    return Math.hypot(c.x - nx, c.y - ny) < radius + gap;
  });
}

/** Nudges a circle away from the type zones so a focal shape never crowds the date or wordmark. */
export function clearOfQuiet(ctx: Ctx, center: Point, radius: number, gap = 28 * ctx.u): Point {
  let p = { ...center };
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (const r of ctx.quiet) {
      const nx = clamp(p.x, r.x, r.x + r.w);
      const ny = clamp(p.y, r.y, r.y + r.h);
      let dx = p.x - nx;
      let dy = p.y - ny;
      let dist = Math.hypot(dx, dy);
      const need = radius + gap;
      if (dist >= need) continue;
      if (dist < 1e-6) {
        dx = p.x - (r.x + r.w / 2);
        dy = p.y - (r.y + r.h / 2);
        dist = Math.hypot(dx, dy) || 1;
        const push = need + Math.max(r.w, r.h) / 2;
        p = { x: r.x + r.w / 2 + (dx / dist) * push, y: r.y + r.h / 2 + (dy / dist) * push };
      } else {
        p = { x: nx + (dx / dist) * need, y: ny + (dy / dist) * need };
      }
      moved = true;
    }
    if (!moved) break;
  }
  return p;
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

/**
 * 0 inside a type zone, rising smoothly to 1 at `reach` px away (one reach per zone, or one for all).
 * Multiply a field by this and it thins out toward the type, so the clearing has no visible edge.
 * `bias` is added to the distance in px, so a noise value there makes the clearing's outline organic.
 */
export function quietFade(ctx: Ctx, p: Point, reach: number | readonly number[], bias = 0): number {
  let fade = 1;
  ctx.quiet.forEach((r, i) => {
    const range = typeof reach === "number" ? reach : (reach[i] ?? reach[0] ?? 1);
    const t = clamp((distanceToRect(p, r) + bias) / range, 0, 1);
    fade = Math.min(fade, t * t * (3 - 2 * t));
  });
  return fade;
}
