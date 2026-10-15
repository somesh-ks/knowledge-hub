import type { Template } from "../../types.js";
import { frame, polygon } from "./kit.js";

/**
 * A big diamond built from small diamonds, coloured ring by ring from a figure-coloured heart out
 * to a quiet rim: a harlequin costume, a quilt block, a Navajo weaving, cut down to three tones.
 */
export const harlequinDiamond: Template = (ctx) => {
  const { pal, rng } = ctx;
  const n = 2;
  const h = 60;
  const cx = 1024 - (2 * n + 1) * h - 18 + rng.range(-8, 8);
  const cy = rng.range(340, 420);
  const rings = rng.chance(0.5)
    ? [pal.accent, pal.shade, pal.accent]
    : [pal.accent, pal.ground, pal.shade];
  const out: string[] = [];
  for (let i = -n; i <= n; i += 1) {
    for (let j = -n; j <= n; j += 1) {
      const fill = rings[Math.max(Math.abs(i), Math.abs(j))] as string;
      if (fill === pal.ground) continue;
      const x = cx + (i - j) * h;
      const y = cy + (i + j) * h;
      const r = h - 4;
      out.push(
        polygon(
          [
            [x, y - r],
            [x + r, y],
            [x, y + r],
            [x - r, y],
          ],
          fill,
        ),
      );
    }
  }
  return frame(ctx, out.join(""));
};
