import type { Template } from "../../types.js";
import { fill, flat, path, polygon, scene } from "./_kit.js";

export const name = "Folded corner";

/**
 * The page's top corner is turned down: the desk shows where it was, the flap lies on the page in the
 * shade, and a quarter sun sits in the opposite corner. Weekly signature: the fold.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const cut = ctx.rng.pick([300, 340, 380]);
  const x = 1024 - cut;
  return scene(
    ctx,
    [
      fill(G),
      polygon(
        [
          [x, 0],
          [1024, 0],
          [1024, cut],
        ],
        M,
      ),
      polygon(
        [
          [x, 0],
          [1024, cut],
          [x, cut],
        ],
        S,
      ),
      path("M1024 724A300 300 0 0 0 724 1024H1024Z", A),
    ].join(""),
  );
};
