import type { Template } from "../../types.js";
import { circle, fill, flat, scene, stroke } from "./_kit.js";

export const name = "Sun path arch";

/**
 * A pale arched window; across it the sun in seven positions, small at dawn and dusk, large at noon.
 * Weekly signature: the arch and the seven suns.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const out = [
    fill(G),
    stroke("M450 560V360A250 250 0 0 1 950 360V560Z", M, 26, ' stroke-linejoin="miter"'),
  ];
  for (let i = 0; i < 7; i += 1) {
    const t = (i / 6) * Math.PI;
    const x = 700 - 160 * Math.cos(t);
    const y = 520 - 330 * Math.sin(t);
    out.push(circle(x, y, i === 3 ? 56 : 22, i === 3 ? A : S));
  }
  return scene(ctx, out.join(""));
};
