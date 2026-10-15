import type { Template } from "../../types.js";
import { fill, flat, polygon, scene } from "./_kit.js";

export const name = "Diagonal split";

/**
 * The cover is cut on the diagonal: a pale half in the top right and a figure stripe along the cut.
 * Weekly signature: the pale diagonal half, which no full-bleed daily has.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const x = ctx.rng.pick([330, 360, 390]);
  return scene(
    ctx,
    [
      fill(G),
      polygon(
        [
          [x, 0],
          [1024, 0],
          [1024, 1024 - x],
        ],
        M,
      ),
      polygon(
        [
          [x - 50, 0],
          [x - 20, 0],
          [1024, 1044 - x],
          [1024, 1074 - x],
        ],
        A,
      ),
    ].join(""),
  );
};
