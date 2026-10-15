import type { Template } from "../../types.js";
import { fill, flat, rect, scene } from "./_kit.js";

export const name = "Seven bars";

/**
 * Seven horizontal bars hang off the right edge like a week's totals, the busiest in the figure
 * colour. Weekly signature: exactly seven pale bars.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const out = [fill(G)];
  const lens = Array.from({ length: 7 }, () => ctx.rng.range(300, 640));
  const top = lens.indexOf(Math.max(...lens));
  lens.forEach((len, i) => {
    out.push(rect(1024 - len, 206 + i * 50, len, 38, i === top ? A : M));
  });
  return scene(ctx, out.join(""));
};
