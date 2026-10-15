import { clearRadius } from "../place.js";
import { n } from "../svg.js";
import type { Template } from "../types.js";
import { polygon } from "./kit.js";

/**
 * Three considered pictures, each one gesture. A twin: a disc balanced on a diagonal cut that reverses
 * with it, accent where the ground is and ground where the accent is. A corner: quarter discs
 * nested in a right-hand corner, a rising sun. A doorway: an arch with a smaller
 * arch inside it, standing on the bottom edge. The cut is pushed right and the corner and doorway sized until the
 * type sits on flat ground, so the seed can lean as hard as it likes without touching it.
 */
export const spring: Template = (ctx) => {
  const { w, u, rng, pal, quiet } = ctx;
  const mode = rng.pick(["twin", "corner", "doorway"] as const);

  if (mode === "doorway") {
    const top = w * rng.range(0.12, 0.28);
    const gap = 30 * u;
    const need = quiet.reduce(
      (right, zone) => (zone.y + zone.h > top - gap ? Math.max(right, zone.x + zone.w + gap) : right),
      0,
    );
    const edge = w - w * rng.range(0.07, 0.12);
    const width = Math.min(w * rng.range(0.4, 0.52), edge - need);
    const arch = (x2: number, from: number, wide: number, fill: string): string => {
      const h = wide / 2;
      return `<path d="M${n(x2 - wide)} ${n(w + 2)}V${n(from + h)}A${n(h)} ${n(h)} 0 0 1 ${n(x2)} ${n(from + h)}V${n(w + 2)}Z" fill="${fill}"/>`;
    };
    const inner = width * rng.range(0.55, 0.66);
    const innermost = inner * 0.45;
    const shift = (outer: number, smaller: number): number => edge - (outer - smaller) / 2;
    return {
      body:
        arch(edge, top, width, pal.accent) +
        arch(shift(width, inner), top + (width - inner) * 0.55, inner, pal.shade) +
        arch(shift(width, innermost), top + (width - innermost) * 0.55, innermost, pal.ground),
    };
  }

  if (mode === "corner") {
    // Nested quarter discs grown from a right-hand corner, as large as the type allows.
    const low = rng.chance(0.6);
    const corner = { x: w, y: low ? w : 0 };
    const reach = Math.min(w * rng.range(0.6, 0.78), clearRadius(ctx, corner) - 26 * u);
    const sweep = low ? 1 : 0;
    const quarter = (radius: number, fill: string): string =>
      `<path d="M${n(corner.x)} ${n(corner.y)}L${n(corner.x - radius)} ${n(corner.y)}A${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(corner.x)} ${n(corner.y + (low ? -radius : radius))}Z" fill="${fill}"/>`;
    const steps = rng.int(2, 3);
    const colours = [pal.accent, pal.shade, pal.ground];
    return {
      body: Array.from({ length: steps }, (_, i) =>
        quarter(reach * (1 - i / steps), colours[i] as string),
      ).join(""),
    };
  }

  // x position of the cut at height y, from its top and bottom intercepts.
  let top = w * rng.range(0.42, 0.74);
  let bottom = w * rng.range(0.34, 0.8);
  const at = (y: number): number => top + ((bottom - top) * y) / w;
  const clearance = 26 * u;
  for (const zone of quiet) {
    const need = zone.x + zone.w + clearance;
    const deficit = Math.max(need - at(zone.y), need - at(zone.y + zone.h));
    if (deficit > 0) {
      top += deficit;
      bottom += deficit;
    }
  }

  // A parallelogram between two cuts, running the full height of the canvas.
  const slab = (
    from: readonly [number, number],
    to: readonly [number, number],
    fill: string,
  ): string =>
    polygon(
      [
        [top + from[0], 0],
        [top + to[0], 0],
        [bottom + to[1], w],
        [bottom + from[1], w],
      ],
      fill,
    );
  const reach = w * 2;

  // Twin: the disc sits on the cut, so the cut is its diameter and each half takes the other side's color.
  const cy = w * rng.range(0.28, 0.62);
  const cx = at(cy);
  const room = clearRadius(ctx, { x: cx, y: cy }) - 24 * u;
  const radius = Math.min(w * rng.range(0.2, 0.3), room);
  const len = Math.hypot(bottom - top, w);
  const dx = ((bottom - top) / len) * radius;
  const dy = (w / len) * radius;
  const p1 = `${n(cx - dx)} ${n(cy - dy)}`;
  const p2 = `${n(cx + dx)} ${n(cy + dy)}`;
  const half = (sweep: 0 | 1, fill: string): string =>
    `<path d="M${p1}A${n(radius)} ${n(radius)} 0 0 ${sweep} ${p2}Z" fill="${fill}"/>`;
  return {
    body: slab([0, 0], [reach, reach], pal.accent) + half(0, pal.accent) + half(1, pal.ground),
  };
};
