import type { Template } from "../../types.js";
import { circle, frame } from "./kit.js";

/**
 * A pegboard of equal dots in which a disc of lit dots appears, one ring of half-lit dots around
 * it. The picture is made of the grid, the way a LED sign draws a circle.
 */
export const dotMatrix: Template = (ctx) => {
  const { pal, rng } = ctx;
  const pitch = 88;
  const cols = 7;
  const rows = 9;
  const x0 = 1024 - cols * pitch + pitch / 2;
  const y0 = 56 + pitch / 2 - 56 + 40;
  const cc = rng.range(2.4, 3.6);
  const cr = rng.range(3, 5);
  const lit = rng.range(2.2, 2.9);
  const out: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const d = Math.hypot(c - cc, r - cr);
      const fill = d <= lit ? pal.accent : d <= lit + 1 ? pal.shade : pal.field;
      out.push(circle(x0 + c * pitch, y0 + r * pitch, 28, fill));
    }
  }
  return frame(ctx, out.join(""));
};
