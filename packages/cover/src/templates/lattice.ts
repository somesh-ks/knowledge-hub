import { smoothstep } from "../math.js";
import { circleHitsQuiet } from "../place.js";
import type { Template } from "../types.js";
import { circle } from "./kit.js";

/**
 * A grid of dots swelling toward one accent dot and thinning away from it. The grid keeps its rhythm
 * everywhere; the type simply takes the cells it needs.
 */
export const lattice: Template = (ctx) => {
  const { w, u, rng, pal, margin } = ctx;
  const columns = rng.int(4, 6);
  const span = w - margin * 2;
  const pitch = span / (columns - 1);
  const rows = Math.floor(span / pitch) + 1;
  const top = (w - (rows - 1) * pitch) / 2;

  // The accent dot is one of the cells in the upper two thirds, away from the date.
  const col = rng.int(Math.floor(columns / 3), columns - 1);
  const row = rng.int(0, Math.max(1, Math.floor(rows * 0.55)));
  const focus = { x: margin + col * pitch, y: top + row * pitch };

  const reach = pitch * rng.range(2.8, 4.6);
  const biggest = pitch * rng.range(0.3, 0.4);
  const smallest = pitch * rng.range(0.12, 0.16);

  const out: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const p = { x: margin + c * pitch, y: top + r * pitch };
      const isFocus = c === col && r === row;
      const near = 1 - smoothstep(0, reach, Math.hypot(p.x - focus.x, p.y - focus.y));
      const radius = isFocus
        ? pitch * rng.range(0.52, 0.64)
        : smallest + (biggest - smallest) * near;
      if (circleHitsQuiet(ctx, p, radius, 4 * u)) continue;
      out.push(circle(p.x, p.y, radius, isFocus ? pal.accent : pal.shade));
    }
  }
  return { body: out.join("") };
};
