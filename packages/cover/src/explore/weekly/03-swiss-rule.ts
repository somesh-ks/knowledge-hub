import type { Template } from "../../types.js";
import { fill, flat, rect, scene } from "./_kit.js";

export const name = "Swiss heavy rule";

/**
 * Swiss poster: one heavy full-bleed rule with a hairline under it, and a single square standing on
 * the rule. Weekly signature: the pale rule across the whole cover.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const x = ctx.rng.pick([480, 620, 744]);
  return scene(
    ctx,
    [
      fill(G),
      rect(x, 190, 280, 280, A),
      rect(0, 470, 1024, 64, M),
      rect(0, 552, 1024, 6, M),
    ].join(""),
  );
};
