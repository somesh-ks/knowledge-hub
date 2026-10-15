import type { Template } from "../../types.js";
import { circle, fill, flat, polygon, rect, scene } from "./_kit.js";

export const name = "Bauhaus in a frame";

/** A thick pale frame around a small Bauhaus stack: square, disc and wedge. Signature: the frame. */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const sq = ctx.rng.chance(0.5) ? 420 : 400;
  return scene(
    ctx,
    [
      fill(M),
      rect(48, 48, 928, 928, G),
      rect(sq, 140, 250, 250, S),
      circle(sq + 280, 330, 140, A),
      polygon(
        [
          [sq + 280, 470],
          [sq + 430, 560],
          [sq + 130, 560],
        ],
        M,
      ),
    ].join(""),
  );
};
