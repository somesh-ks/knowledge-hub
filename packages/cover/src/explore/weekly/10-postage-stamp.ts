import type { Template } from "../../types.js";
import { circle, fill, flat, rect, scene } from "./_kit.js";

export const name = "Postage stamp";

/**
 * A stamp with a perforated pale edge and a small view in its window. Weekly signature: the
 * scalloped pale edge.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const x0 = 380;
  const y0 = 84;
  const w = 580;
  const h = 476;
  const out = [fill(G), rect(x0, y0, w, h, M)];
  for (let i = 0; i <= 12; i += 1) {
    const x = x0 + (i * w) / 12;
    out.push(circle(x, y0, 11, G), circle(x, y0 + h, 11, G));
  }
  for (let j = 0; j <= 10; j += 1) {
    const y = y0 + (j * h) / 10;
    out.push(circle(x0, y, 11, G), circle(x0 + w, y, 11, G));
  }
  out.push(rect(x0 + 44, y0 + 44, w - 88, h - 88, G));
  out.push(circle(x0 + w / 2, y0 + h / 2 - 20, 100, A));
  out.push(rect(x0 + 44, y0 + h - 44 - 96, w - 88, 96, S));
  return scene(ctx, out.join(""));
};
