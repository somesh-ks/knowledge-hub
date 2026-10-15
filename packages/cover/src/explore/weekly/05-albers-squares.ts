import type { Template } from "../../types.js";
import { fill, flat, rect, scene } from "./_kit.js";

export const name = "Homage squares";

/**
 * Albers: four rectangles nested toward the floor, pale outermost, the last a window onto the
 * ground. Weekly signature: the pale outer rectangle, like a mount.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const cols = ctx.rng.chance(0.5) ? [M, A, S, G] : [M, S, A, G];
  const out = [fill(G)];
  cols.forEach((c, i) => {
    out.push(rect(380 + i * 56, 96 + i * 80, 584 - i * 112, 456 - i * 104, c));
  });
  return scene(ctx, out.join(""));
};
