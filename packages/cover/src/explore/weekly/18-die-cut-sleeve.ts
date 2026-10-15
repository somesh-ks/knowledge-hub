import type { Template } from "../../types.js";
import { circle, fill, flat, rect, scene } from "./_kit.js";

export const name = "Die-cut sleeve";

/** A pale record sleeve with a round window cut in it and the disc showing through. Signature: the sleeve. */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  return scene(
    ctx,
    [
      fill(G),
      rect(400, 90, 570, 470, M),
      circle(685, 325, 190, G),
      circle(685, 325, 158, A),
      circle(685, 325, 56, S),
      circle(685, 325, 10, G),
    ].join(""),
  );
};
