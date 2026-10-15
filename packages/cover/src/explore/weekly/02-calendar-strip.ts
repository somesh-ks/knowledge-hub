import type { Template } from "../../types.js";
import { fill, flat, rect, scene } from "./_kit.js";

export const name = "Calendar strip";

/**
 * A pale band bleeds across the cover with seven cut-out day cells in it, one filled with the figure
 * colour. Weekly signature: the band and its seven windows.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const hot = ctx.rng.int(0, 6);
  const out = [fill(G), rect(0, 250, 1024, 230, M)];
  for (let i = 0; i < 7; i += 1) {
    out.push(rect(116 + i * 116, 290, 100, 150, i === hot ? A : G));
  }
  return scene(ctx, out.join(""));
};
