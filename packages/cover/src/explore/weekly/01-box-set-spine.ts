import type { Template } from "../../types.js";
import { circle, fill, flat, rect, scene } from "./_kit.js";

export const name = "Box set spine";

/**
 * A record box set seen from the front: a pale slipcase edge down the right side with seven spines
 * standing in it, one in the figure colour, and the first disc leaning beside it.
 * Weekly signature: the pale slab and its seven bars.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const hot = ctx.rng.int(0, 6);
  const out = [fill(G), rect(790, 0, 234, 1024, M)];
  for (let i = 0; i < 7; i += 1) {
    out.push(rect(818 + i * 28, 96, 20, 832, i === hot ? A : i % 2 ? S : G));
  }
  out.push(circle(470, 340, 190, A), circle(470, 340, 62, G), circle(470, 340, 12, A));
  return scene(ctx, out.join(""));
};
