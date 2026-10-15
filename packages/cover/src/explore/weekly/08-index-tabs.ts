import type { Template } from "../../types.js";
import { fill, flat, rect, scene } from "./_kit.js";

export const name = "Index card tabs";

/**
 * A filing card on a pale desk with seven divider tabs down its edge, one in the figure colour and
 * a header rule across the card. Weekly signature: the tabs.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const hot = ctx.rng.int(0, 6);
  const out = [fill(M), rect(40, 40, 860, 944, G), rect(128, 292, 700, 6, A)];
  for (let i = 0; i < 7; i += 1) {
    out.push(rect(890, 120 + i * 86, 94, 66, i === hot ? A : G, 14));
  }
  return scene(ctx, out.join(""));
};
