import type { Template } from "../../types.js";
import { fill, flat, rect, scene, stroke } from "./_kit.js";

export const name = "Zigzag W";

/** A W drawn as one folded stroke, with a figure square for its full stop. Signature: the big W. */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  return scene(
    ctx,
    [
      fill(G),
      stroke("M392 200L520 540L648 290L776 540L904 200", M, 84, ' stroke-linejoin="bevel"'),
      rect(800, 620, 140, 140, A),
    ].join(""),
  );
};
