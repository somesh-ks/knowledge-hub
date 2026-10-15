import type { Template } from "../../types.js";
import { frame, tri } from "./kit.js";

/**
 * Four right triangles turning about a centre, the classic pinwheel tile of Bauhaus textile
 * studies. What is left between them is ground, so a square windmill appears from nothing.
 */
export const pinwheel: Template = (ctx) => {
  const { pal, rng } = ctx;
  const h = rng.range(205, 225);
  const x0 = 1024 - 2 * h - rng.range(60, 110);
  const y0 = rng.range(110, 220);
  const flip = rng.chance(0.5);
  const fills = rng.chance(0.5)
    ? [pal.accent, pal.shade, pal.accent, pal.shade]
    : [pal.accent, pal.field, pal.shade, pal.field];
  const mx = x0 + h;
  const my = y0 + h;
  const raw = [
    tri([x0, y0], [mx, y0], [x0, my], fills[0] as string),
    tri([x0 + 2 * h, y0], [x0 + 2 * h, my], [mx, y0], fills[1] as string),
    tri([x0 + 2 * h, y0 + 2 * h], [mx, y0 + 2 * h], [x0 + 2 * h, my], fills[2] as string),
    tri([x0, y0 + 2 * h], [x0, my], [mx, y0 + 2 * h], fills[3] as string),
  ];
  const body = raw.join("");
  return frame(ctx, flip ? `<g transform="translate(${mx * 2} 0) scale(-1 1)">${body}</g>` : body);
};
