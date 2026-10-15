import type { Template } from "../../types.js";
import { fill, flat, rect, scene } from "./_kit.js";

export const name = "Masthead columns";

/**
 * A newspaper front: double rule under the masthead line, column rules and three blocks standing in
 * for the lead picture and heads. Weekly signature: the double rule and the column rules.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  return scene(
    ctx,
    [
      fill(G),
      rect(0, 226, 1024, 14, M),
      rect(0, 252, 1024, 4, M),
      rect(360, 256, 4, 300, M),
      rect(690, 256, 4, 300, M),
      rect(722, 290, 302, 220, A),
      rect(392, 290, 270, 120, S),
      rect(392, 430, 270, 80, S),
      rect(98, 290, 232, 76, S),
      rect(0, 570, 1024, 4, M),
    ].join(""),
  );
};
