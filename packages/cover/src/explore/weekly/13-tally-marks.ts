import type { Template } from "../../types.js";
import { fill, flat, rect, scene, stroke } from "./_kit.js";

export const name = "Tally marks";

/**
 * Seven days counted the old way: a gate of four strokes struck through in the figure colour, then
 * two more. Weekly signature: the tally, which no daily draws.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const out = [fill(G)];
  for (const x of [420, 500, 580, 660, 800, 880]) out.push(rect(x - 19, 206, 38, 340, M));
  out.push(stroke("M384 540L698 214", A, 26));
  return scene(ctx, out.join(""));
};
